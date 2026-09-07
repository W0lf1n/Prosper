using Microsoft.EntityFrameworkCore;

namespace Prosper.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<ChangeRow> Changes => Set<ChangeRow>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<SyncState> SyncState => Set<SyncState>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<ChangeRow>(entity =>
        {
            entity.ToTable("changes");
            entity.HasKey(e => e.Id);

            // One row per entity: a push updates in place rather than appending,
            // so the table stays the size of the ledger instead of the size of
            // its history. The history that matters is the ledger's own soft
            // deletes, which are rows like any other.
            entity.HasIndex(e => new { e.Entity, e.EntityId }).IsUnique();

            // The pull index. Every pull is "everything past this number", in
            // order, so this is the only access path that needs to be fast.
            entity.HasIndex(e => e.Seq).IsUnique();

            entity.Property(e => e.Entity).HasMaxLength(32);
            entity.Property(e => e.EntityId).HasMaxLength(64);
            entity.Property(e => e.UpdatedAt).HasMaxLength(40);
            entity.Property(e => e.DeviceId).HasMaxLength(64);
        });

        model.Entity<Device>(entity =>
        {
            entity.ToTable("devices");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TokenHash).IsUnique();
            entity.Property(e => e.Id).HasMaxLength(64);
            entity.Property(e => e.Name).HasMaxLength(Device.NameMaxLength);
            entity.Property(e => e.TokenHash).HasMaxLength(88);
        });

        model.Entity<SyncState>(entity =>
        {
            entity.ToTable("sync_state");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedNever();
        });
    }
}
