export function Status({ loading, error, empty, emptyText = "Nothing here yet." }) {
  if (loading) return <p className="empty">Loading...</p>;
  if (error) return <p className="empty error">{error}</p>;
  if (empty) return <p className="empty">{emptyText}</p>;
  return null;
}
