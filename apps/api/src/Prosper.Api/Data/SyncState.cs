namespace Prosper.Api.Data;

/// <summary>
/// The cursor allocator — a single row holding the highest sequence handed out.
///
/// A database sequence would be the obvious tool and is deliberately not used:
/// a sequence is not transactional, so a push that rolls back leaves a hole in
/// the cursor space, and a client that has already stored the higher number
/// then skips whatever fills that hole later. A counter in the same transaction
/// as the rows it numbers cannot do that.
///
/// This serialises pushes against each other. With one user and one ledger that
/// is not a bottleneck, it is a guarantee.
/// </summary>
public sealed class SyncState
{
    public int Id { get; set; }
    public long LastSeq { get; set; }
}
