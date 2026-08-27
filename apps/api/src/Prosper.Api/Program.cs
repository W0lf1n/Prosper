using System.Text.Json;
using System.Text.Json.Serialization;
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
});

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
