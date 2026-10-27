try {
  const response = await fetch(process.argv[2], {
    signal: AbortSignal.timeout(4_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
