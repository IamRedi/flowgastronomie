// Acceptance coordinates each real venue independently; production controls stay strict.
export async function waitForReadCondition(
  fn,
  ms = 300000,
  {
    now = Date.now,
    delay = () => new Promise((resolve) => setTimeout(resolve, 500)),
  } = {},
) {
  const end = now() + ms;
  while (now() < end) {
    try {
      if (await fn()) return;
    } catch (error) {
      // Only an explicitly classified read timeout may be observed again.
      // Domain/authentication failures and uncertain mutations remain failures.
      if (error.cause?.code !== "LAB_TRANSIENT_OPERATOR_READ") throw error;
    }
    await delay();
  }
  throw new Error("BACKGROUND_ACCEPTANCE_CONDITION_TIMEOUT");
}

export async function changeControlWithRecovery(
  profile,
  mode,
  op,
  {
    attempts = 8,
    delay = () => new Promise((resolve) => setTimeout(resolve, 500)),
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const state = await op("/status");
      const venue = state.venues.find((v) => v.profile === profile);
      if (!venue) throw new Error("LAB_CONTROL_PROFILE_MISSING");
      // An uncertain metadata response may already have committed. Observe it
      // before issuing another CAS. This helper never retries financial actions.
      if (venue.mode === mode) return;
      await op("/control", { profile, mode, expectedVersion: venue.version });
      return;
    } catch (error) {
      if (
        (error.cause?.code !== "LAB_TRANSIENT_DATABASE" &&
          !/Server has closed the connection|Can't reach database server|Connection terminated unexpectedly/.test(
            error.message,
          )) ||
        attempt + 1 === attempts
      )
        throw error;
      await delay();
    }
  }
}
export async function pauseReadyVenues(venues, ready, pause) {
  let allReady = true;
  for (const venue of venues) {
    if (!ready(venue)) {
      allReady = false;
      continue;
    }
    if (venue.mode === "PAUSED") continue;
    if (!["RUNNING", "STOP_AFTER_DAY"].includes(venue.mode))
      throw new Error(
        `LAB2 checkpoint unavailable: ${venue.profile} ${venue.mode} ${venue.incident ?? ""}`,
      );
    await pause(venue.profile);
    allReady = false; // Verify the durable PAUSED state in the next actual snapshot.
  }
  return allReady;
}

// The other venue keeps running while the faulted venue reaches its committed
// payment. Observe its checkpoint during that wait, before it can finish its day.
export async function waitForFaultCrashWithSiblingCheckpoint(
  hasExited,
  readVenues,
  pause,
  { wait = waitForReadCondition } = {},
) {
  await wait(async () => {
    if (hasExited()) return true;
    await pauseReadyVenues(
      (await readVenues()).filter((venue) => venue.profile !== "DE"),
      (venue) => venue.counts.own >= 3,
      pause,
    );
    return hasExited();
  }, 180000);
}
