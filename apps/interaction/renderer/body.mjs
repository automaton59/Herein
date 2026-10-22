export function motionSpec(value) {
  return typeof value === "string" ? { group: value } : value;
}

// Execution state drives the body. Speech content and proactive decisions belong to C.
export class BodyAnimator {
  constructor(manifest, driver) {
    this.manifest = manifest;
    this.driver = driver;
    this.state = "idle";
    this.emotion = "neutral";
    this.motionName = null;
    this.ticket = 0;
    this.transientEmotion = false;
  }
  async start(name, transientEmotion) {
    const spec = motionSpec(this.manifest.motions?.[name]);
    if (!spec) return false;
    const ticket = ++this.ticket;
    if (this.transientEmotion) this.driver.expression(this.emotion);
    this.motionName = name;
    this.transientEmotion = Boolean(transientEmotion);
    this.driver.stop();
    if (transientEmotion) this.driver.expression(transientEmotion);
    const played = await this.driver.play(spec);
    if (ticket !== this.ticket) return false;
    if (!played) this.motionName = null;
    return played;
  }
  stateMotion() {
    return this.manifest.states?.[this.state] || "idle";
  }
  setState(state) {
    if (state === this.state && this.motionName) return;
    const previous = this.state;
    this.state = state;
    // Restore the resting face after actual speech, cancellation, or pause.
    if (["thinking", "speaking"].includes(previous) &&
        !["thinking", "speaking"].includes(state)) this.expression("neutral");
    void this.start(this.stateMotion());
  }
  expression(emotion) {
    if (typeof emotion !== "string") return;
    this.emotion = emotion;
    this.transientEmotion = false;
    this.driver.expression(emotion);
  }
  motion(name) {
    return this.start(name);
  }
  interact(kind) {
    const interaction = this.manifest.interactions?.[kind];
    if (interaction) return this.start(interaction.motion, interaction.emotion);
    return this.start(kind);
  }
  finished() {
    const spec = motionSpec(this.manifest.motions?.[this.motionName]);
    if (spec?.loop) return;
    this.motionName = null;
    void this.start(this.stateMotion());
  }
  destroy() {
    this.ticket++;
    this.driver.stop();
  }
}
