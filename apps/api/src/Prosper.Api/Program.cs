using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;
using Prosper.Api.Sync;

var builder = WebApplication.CreateBuilder(args);

// camelCase on the wire, because the client is TypeScript and the contracts
// package is the shared definition. The mirror is checked by a round-trip test.
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});

// Postgres in production (§4). SQLite exists so the server can be run and
// tested on a laptop with no Docker — it is the same EF model either way, and
// a sync layer nobody can run locally is a sync layer nobody checks.
builder.Services.AddDbContext<AppDbContext>(options =>
{
    var provider = builder.Configuration["Database:Provider"] ?? "postgres";
    if (string.Equals(provider, "sqlite", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(builder.Configuration.GetConnectionString("Sqlite")
                          ?? "Data Source=prosper.db");
    }
    else
    {
        options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres"));
    }
});

builder.Services.AddScoped<SyncService>();
builder.Services.AddScoped<DeviceAuth>();

// The pairing code is the only thing between the internet and the whole ledger.
// `DEPLOYMENT.md` generates twelve digits, because the code's own length is the
// only defence here that does not depend on a fence holding. `CodeMatches` being
// constant-time defends against timing, not against volume.
//
// Five attempts a minute per address turns twelve digits into a number of years
// nobody has. `ClientAddress` is what makes "per address" true — the header it
// reads is one the caller cannot write, and the header it deliberately ignores
// is the one that reads like the obvious choice. The second fence is `limit_req`
// in `deploy/nginx/app.conf`, one layer out, because a limiter living in this
// process resets every time `docker compose up -d --build` restarts it.
//
// Pairing happens once in a device's life, so the limit is invisible to the
// person actually doing it.
const string PairPolicy = "pair";

/// <summary>
/// Attempts an hour on the pairing endpoint as a whole, from everywhere.
///
/// The per-address window below is what makes one caller slow. This is what
/// makes ten thousand of them slow together — a guess spread across many
/// addresses is the one attack per-address counting does not touch, and the
/// arithmetic in <c>deploy/.env.example</c> ("thirty-four years") assumed it.
/// Twenty is more pairing than a household does in a year, and it turns twelve
/// digits into a number of years from any number of addresses.
///
/// The cost is the obvious one: a stranger who spends the twenty keeps you
/// from pairing for the rest of the hour, and can go on doing it. That is the
/// fence holding against exactly the thing it is for; the container's access
/// log names the address, and pairing is a thing that can wait an hour.
/// </summary>
const int PairAttemptsPerHour = 20;

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
        http.Request.Path.Equals(new PathString("/api/v1/pair"), StringComparison.OrdinalIgnoreCase)
            ? RateLimitPartition.GetFixedWindowLimiter("pair-everyone", _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = PairAttemptsPerHour,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0
            })
            // Every other route is fenced by its bearer token, not by a clock.
            : RateLimitPartition.GetNoLimiter("open"));

    options.AddPolicy(PairPolicy, http => RateLimitPartition.GetFixedWindowLimiter(
        ClientAddress.PartitionKey(
            http.Request.Headers["X-Real-IP"].FirstOrDefault(),
            http.Connection.RemoteIpAddress),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            // No queue: a pairing attempt that has to wait is a wrong guess.
            QueueLimit = 0
        }));
});

// The client is served from the same origin in production (§4), so there is no
// CORS policy by default and deliberately no wildcard one: a sync endpoint any
// page can call is a sync endpoint any page can drain. An explicit allowlist
// exists only so the Vite dev server on another port can be developed against.
var allowedOrigins = builder.Configuration
    .GetSection("Cors:Origins")
    .Get<string[]>() ?? [];

if (allowedOrigins.Length > 0)
{
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .WithHeaders("authorization", "content-type")
        .WithMethods("GET", "POST")));
}

var app = builder.Build();

if (allowedOrigins.Length > 0) app.UseCors();

app.UseRateLimiter();

if (app.Configuration.GetValue("Database:MigrateOnStart", true))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreatedAsync();
}

var version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.1";

app.MapGet("/api/v1/health", () => Results.Ok(new HealthResponse(true, version)));

app.MapPost("/api/v1/pair", async (
    PairRequest request,
    IConfiguration config,
    DeviceAuth auth,
    CancellationToken ct) =>
{
    var expected = config["Pairing:Code"];
    if (string.IsNullOrWhiteSpace(expected))
    {
        // Refusing is the safe default: an unset code must never mean "any code
        // will do", which is how a private ledger becomes a public one.
        return Results.Problem("Párování není na serveru nastavené.", statusCode: 503);
    }

    if (!DeviceAuth.CodeMatches(expected, request.Code ?? string.Empty))
    {
        return Results.Unauthorized();
    }

    return Results.Ok(await auth.PairAsync(request.DeviceName ?? "Zařízení", ct));
}).RequireRateLimiting(PairPolicy);

app.MapPost("/api/v1/sync/push", async (
    PushRequest request,
    HttpContext http,
    DeviceAuth auth,
    SyncService sync,
    CancellationToken ct) =>
{
    var device = await auth.ResolveAsync(http.Request.Headers.Authorization, ct);
    if (device is null) return Results.Unauthorized();

    if (request.Changes is null) return Results.BadRequest("Chybí changes.");
    if (request.Changes.Count > SyncLimits.MaxPushBatch)
        return Results.BadRequest($"Nejvýš {SyncLimits.MaxPushBatch} řádků na dávku.");

    return Results.Ok(await sync.PushAsync(request.Changes, ct));
});

app.MapGet("/api/v1/sync/pull", async (
    long since,
    int? limit,
    HttpContext http,
    DeviceAuth auth,
    SyncService sync,
    CancellationToken ct) =>
{
    var device = await auth.ResolveAsync(http.Request.Headers.Authorization, ct);
    if (device is null) return Results.Unauthorized();

    return Results.Ok(await sync.PullAsync(since, limit ?? SyncLimits.MaxPullPage, ct));
});

app.Run();

/// <summary>Named so the test host can reach it.</summary>
public partial class Program;
