export function Kbd({ keys }: { keys: string }) {
  return (
    <span className="kbd-hint" aria-hidden="true">
      {keys.split(' ').map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}
