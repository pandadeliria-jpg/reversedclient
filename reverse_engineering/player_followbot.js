/**
 * Basic player follow-bot for this reversed Arras client.
 *
 * Expected globals from the client runtime:
 * - window.update_data (instance of update_parser)
 * - window.packet_queue (array consumed by sender_and_analytics_blocker_import)
 *
 * Optional globals used if present:
 * - window.construct_control_packet
 * - window.yield_control_comps_from_angle
 */
(function initPlayerFollowBot() {
  const DEFAULT_DIRECTION_BITS = {
    up: 1,
    left: 2,
    down: 4,
    right: 8,
  };

  const localConstructControlPacket = (xComp, yComp, direction) =>
    new Uint8Array([67, xComp, yComp, direction]);

  const localYieldControlCompsFromAngle = (angle) => {
    const cartesianXComp = -Math.cos(angle);
    const cartesianYComp = Math.sin(angle);
    let xComp = Math.floor(Math.abs(cartesianXComp) * 64);
    let yComp = Math.floor(Math.abs(cartesianYComp) * 64);
    if (cartesianXComp < 0) xComp = 191 - xComp;
    if (cartesianYComp > 0) yComp = 191 - yComp;
    return [xComp, yComp];
  };

  const encodeDirection = (dx, dy, bits) => {
    let direction = 0;
    if (dy < 0) direction |= bits.up;
    if (dy > 0) direction |= bits.down;
    if (dx < 0) direction |= bits.left;
    if (dx > 0) direction |= bits.right;
    return direction;
  };

  class PlayerFollowBot {
    constructor(config = {}) {
      this.targetId = config.targetId ?? null;
      this.targetName = config.targetName ?? null;
      this.minDistance = config.minDistance ?? 40;
      this.maxDistance = config.maxDistance ?? 180;
      this.sendIntervalMs = config.sendIntervalMs ?? 40;
      this.directionBits = { ...DEFAULT_DIRECTION_BITS, ...(config.directionBits || {}) };

      this.active = false;
      this.timer = null;
      this.lastFacingAngle = 0;
    }

    setTargetId(targetId) {
      this.targetId = targetId;
    }

    setTargetName(targetName) {
      this.targetName = targetName;
    }

    start() {
      if (this.active) return;
      this.active = true;
      this.timer = setInterval(() => this.tick(), this.sendIntervalMs);
    }

    stop() {
      this.active = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.sendControl(this.lastFacingAngle, 0);
    }

    tick() {
      const updateData = window.update_data;
      if (!updateData || !updateData.player || !updateData.entities) return;

      const me = updateData.player;
      if (typeof me.x !== "number" || typeof me.y !== "number") return;

      const target = this.findTarget(updateData.entities, me.id);
      if (!target || typeof target.x !== "number" || typeof target.y !== "number") {
        this.sendControl(this.lastFacingAngle, 0);
        return;
      }

      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const distance = Math.hypot(dx, dy);
      const facingAngle = Math.atan2(dy, dx);
      this.lastFacingAngle = facingAngle;

      if (distance <= this.minDistance) {
        this.sendControl(facingAngle, 0);
        return;
      }

      if (distance > this.maxDistance) {
        this.sendControl(facingAngle, encodeDirection(dx, dy, this.directionBits));
        return;
      }

      const direction = encodeDirection(dx, dy, this.directionBits);
      this.sendControl(facingAngle, direction);
    }

    findTarget(entities, ownId) {
      if (this.targetId != null && entities[this.targetId]) {
        return entities[this.targetId];
      }

      if (this.targetName) {
        const normalized = this.targetName.toLowerCase();
        for (const id in entities) {
          const entity = entities[id];
          if (Number(id) === ownId) continue;
          if (!entity || typeof entity.name !== "string") continue;
          if (entity.name.toLowerCase() === normalized) {
            return entity;
          }
        }
      }

      let nearest = null;
      let nearestDistance = Infinity;
      const me = window.update_data?.player;
      if (!me) return null;

      for (const id in entities) {
        const entity = entities[id];
        if (Number(id) === ownId || !entity) continue;
        if (typeof entity.x !== "number" || typeof entity.y !== "number") continue;
        const dist = Math.hypot(entity.x - me.x, entity.y - me.y);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearest = entity;
        }
      }

      return nearest;
    }

    sendControl(angle, direction) {
      const queue = window.packet_queue;
      if (!Array.isArray(queue)) return;

      const compsFromAngle =
        typeof window.yield_control_comps_from_angle === "function"
          ? window.yield_control_comps_from_angle
          : localYieldControlCompsFromAngle;

      const constructPacket =
        typeof window.construct_control_packet === "function"
          ? window.construct_control_packet
          : localConstructControlPacket;

      const [xComp, yComp] = compsFromAngle(angle);
      const packet = constructPacket(xComp, yComp, direction);
      queue.unshift(packet);
    }
  }

  window.PlayerFollowBot = PlayerFollowBot;

  // Convenience singleton:
  // window.followBot.start(), window.followBot.stop(), window.followBot.setTargetName("name")
  if (!window.followBot) {
    window.followBot = new PlayerFollowBot();
  }
})();
