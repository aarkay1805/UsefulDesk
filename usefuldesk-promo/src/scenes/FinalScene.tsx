import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import {ArrowIcon, Brand, SceneBackground} from "../components";

export const FinalScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: "#0d0d14", overflow: "hidden", alignItems: "center", justifyContent: "center"}}>
      <SceneBackground />
      <Interactive.Div
        name="Final content"
        style={{
          position: "relative",
          width: 920,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          opacity: interpolate(frame, [0, 18, 104, 119], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
          }),
        }}
      >
        <Brand />
        <Interactive.Div
          name="Final headline"
          style={{
            marginTop: 58,
            color: "#ffffff",
            fontSize: 90,
            lineHeight: 0.98,
            fontWeight: 790,
            letterSpacing: "-0.065em",
            translate: interpolate(frame, [6, 28], ["0px 44px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Run your gym from one action list.
        </Interactive.Div>
        <Interactive.Div
          name="Final promise"
          style={{
            marginTop: 28,
            color: "#aaa6b6",
            fontSize: 31,
            lineHeight: 1.4,
            fontWeight: 520,
            letterSpacing: "-0.02em",
            opacity: interpolate(frame, [24, 42], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Open UsefulDesk. Know what needs action in 30 seconds.
        </Interactive.Div>
        <Interactive.Div
          name="Website call to action"
          style={{
            marginTop: 50,
            height: 74,
            padding: "0 28px 0 32px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            borderRadius: 999,
            color: "#ffffff",
            backgroundColor: "#7c3aed",
            boxShadow: "0 22px 70px rgba(124,58,237,0.36)",
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            scale: interpolate(frame, [42, 64], [0.86, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({damping: 180}),
              output: "perceptual-scale",
            }),
          }}
        >
          desk.usefulmade.com
          <ArrowIcon />
        </Interactive.Div>
        <Interactive.Div
          name="Final feature line"
          style={{
            marginTop: 38,
            color: "#777382",
            fontSize: 20,
            fontWeight: 570,
            letterSpacing: "0.02em",
            opacity: interpolate(frame, [56, 74], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          MEMBERS · WHATSAPP · UPI · FOLLOW-UPS
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
