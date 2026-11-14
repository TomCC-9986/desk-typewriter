import type { AppView, FlyRequest } from "../../shared/ipc-types";
import { ballClip, creaseBackground } from "../paper";
import { setVolume, sfx } from "../sound";

void window.desk.invoke<AppView>("state:get").then((v) => setVolume(v.settings.volume));

window.desk.on("fx:fly", (r: FlyRequest) => {
  const ball = document.createElement("div");
  ball.className = "ball";
  const skin = document.createElement("div");
  skin.style.clipPath = ballClip(58);
  skin.style.background = `${creaseBackground(18)}, #f2ebdc`;
  ball.style.backgroundColor = "transparent";
  ball.append(skin);
  document.body.append(ball);
  const fx = r.from.x - r.origin.x, fy = r.from.y - r.origin.y;
  const tx = r.to.x - r.origin.x, ty = r.to.y - r.origin.y;
  const peak = Math.min(fy, ty) - 220;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = fx + (tx - fx) * t;
    const y = (1 - t) ** 2 * fy + 2 * (1 - t) * t * peak + t * t * ty; // quadratic arc
    frames.push({ transform: `translate(${x - 29}px, ${y - 29}px) rotate(${t * 540}deg) scale(${1 - 0.55 * t})` });
  }
  const anim = ball.animate(frames, { duration: 950, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" });
  anim.onfinish = () => {
    sfx.drop();
    ball.remove();
    window.desk.send("fx:done", r.id);
  };
});
