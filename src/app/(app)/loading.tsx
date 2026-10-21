export default function AppLoading() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="読み込み中"
    >
      <div className="h-8 w-44 animate-pulse rounded-lg bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="h-44 animate-pulse rounded-xl bg-muted" />
      <span className="sr-only">読み込み中</span>
    </div>
  );
}
