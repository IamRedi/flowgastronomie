export async function runVenueLoops(
  tick: (profile: "DE" | "AL") => Promise<void>,
  onError: (profile: "DE" | "AL", error: unknown) => Promise<void>,
  stopped: () => boolean,
) {
  await Promise.all(
    (["DE", "AL"] as const).map(async (profile) => {
      while (!stopped()) {
        try {
          await tick(profile);
        } catch (error) {
          await onError(profile, error);
        }
        if (!stopped())
          await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }),
  );
}
