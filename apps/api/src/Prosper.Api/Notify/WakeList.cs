using System.Globalization;

namespace Prosper.Api.Notify;

/// <summary>
/// The instants a phone asked to be woken at, as the server keeps them.
///
/// The phone does every bit of calendar work — the evening minute, the due
/// days, the time zone and its summer time — and sends UTC instants. The
/// server keeps a sorted list of Unix milliseconds and pops the front, which
/// is the whole of its knowledge about time: no zone, no tz database, no
/// opinion about what 21:00 means.
/// </summary>
public static class WakeList
{
    /// <summary>Mirrors <c>MAX_WAKES</c> in the contracts package.</summary>
    public const int MaxWakes = 128;

    /// <summary>
    /// How late a wake may still be sent. A server back from a restart at
    /// 21:20 still asks the evening question; one back at 23:40 does not buzz
    /// a phone about a day that is nearly over.
    /// </summary>
    public static readonly TimeSpan Grace = TimeSpan.FromMinutes(45);

    /// <summary>
    /// The request's instants, checked: each must be an ISO 8601 instant with an
    /// offset, the list no longer than <see cref="MaxWakes"/>. Past ones are
    /// dropped, the rest sorted and de-duplicated. Null with the reason when
    /// the list is refused.
    /// </summary>
    public static (long[]? Wakes, string? Error) Parse(IReadOnlyList<string>? given, DateTimeOffset now)
    {
        if (given is null) return ([], null);
        if (given.Count > MaxWakes) return (null, $"Nejvýš {MaxWakes} časů.");

        var nowMs = now.ToUnixTimeMilliseconds();
        var wakes = new SortedSet<long>();
        foreach (var text in given)
        {
            if (!DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var instant)
                || !text.Contains('T'))
            {
                return (null, $"Tohle není čas: {Trim(text)}");
            }
            var ms = instant.ToUnixTimeMilliseconds();
            if (ms > nowMs) wakes.Add(ms);
        }
        return (wakes.ToArray(), null);
    }

    /// <summary>
    /// The wake that is due now, if any, and the list without everything up to
    /// now. Several overdue wakes collapse into one push — the phone says
    /// whatever is due when it wakes, so two pushes would say it once anyway.
    /// </summary>
    public static (bool Send, long[] Remaining) Take(long[] wakes, DateTimeOffset now)
    {
        var nowMs = now.ToUnixTimeMilliseconds();
        var graceMs = nowMs - (long)Grace.TotalMilliseconds;
        var due = wakes.Where(w => w <= nowMs).ToArray();
        var rest = wakes.Where(w => w > nowMs).ToArray();
        return (due.Any(w => w >= graceMs), rest);
    }

    public static long? Next(long[] wakes) => wakes.Length == 0 ? null : wakes[0];

    public static string Serialize(long[] wakes) =>
        string.Join(',', wakes.Select(w => w.ToString(CultureInfo.InvariantCulture)));

    public static long[] Deserialize(string? stored) =>
        string.IsNullOrEmpty(stored)
            ? []
            : stored.Split(',').Select(s => long.Parse(s, CultureInfo.InvariantCulture)).ToArray();

    private static string Trim(string? text) =>
        text is null ? "null" : text.Length <= 40 ? text : text[..40] + "…";
}
