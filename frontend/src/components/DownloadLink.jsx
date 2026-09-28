export default function DownloadLink({ item }) {
  const href = item.fileUrl || item.externalLink;
  if (!href) return <span className="muted">Coming soon</span>;
  return <a className="button small" href={href} target="_blank" rel="noreferrer">Download</a>;
}
