import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import {Brand, CheckIcon, SceneBackground} from "../components";

export const CollectScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: "#0d0d14", overflow: "hidden"}}>
      <SceneBackground accent="green" />
      <div style={{position: "absolute", inset: "70px 80px", display: "flex", flexDirection: "column"}}>
        <Brand compact />
        <div style={{flex: 1, display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 54, alignItems: "center"}}>
          <div>
            <Interactive.Div
              name="Collection headline"
              style={{
                color: "#ffffff",
                fontSize: 80,
                lineHeight: 1.01,
                fontWeight: 780,
                letterSpacing: "-0.06em",
                opacity: interpolate(frame, [0, 18], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                translate: interpolate(frame, [0, 22], ["0px 42px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              Collect on UPI.
              <br />
              See it settle.
            </Interactive.Div>
            <Interactive.Div
              name="Collection subtitle"
              style={{
                marginTop: 28,
                color: "#aaa6b6",
                fontSize: 29,
                lineHeight: 1.42,
                fontWeight: 510,
                letterSpacing: "-0.02em",
                maxWidth: 480,
                opacity: interpolate(frame, [18, 34], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              Manual or AutoPay—every collection lands in one member ledger.
            </Interactive.Div>
          </div>
          <Interactive.Div
            name="Payment confirmation"
            style={{
              borderRadius: 36,
              border: "1px solid rgba(255,255,255,0.12)",
              padding: "42px 38px",
              background: "linear-gradient(165deg,rgba(27,35,31,0.98) 0%,rgba(21,22,31,0.98) 100%)",
              boxShadow: "0 46px 100px rgba(0,0,0,0.38)",
              opacity: interpolate(frame, [18, 38], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              scale: interpolate(frame, [18, 44], [0.9, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({damping: 200}),
                output: "perceptual-scale",
              }),
            }}
          >
            <Interactive.Div
              name="Paid check"
              style={{
                width: 86,
                height: 86,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                backgroundColor: "#22c55e",
                boxShadow: "0 0 0 14px rgba(34,197,94,0.10)",
                scale: interpolate(frame, [42, 62], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.spring({damping: 150}),
                  output: "perceptual-scale",
                }),
              }}
            >
              <CheckIcon size={42} />
            </Interactive.Div>
            <div style={{fontSize: 22, color: "#86efac", fontWeight: 680, marginTop: 34}}>Payment received</div>
            <Interactive.Div
              name="Collected amount"
              style={{
                color: "#ffffff",
                fontSize: 76,
                lineHeight: 1,
                fontWeight: 790,
                letterSpacing: "-0.06em",
                marginTop: 12,
                fontVariantNumeric: "tabular-nums",
                opacity: interpolate(frame, [48, 66], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              ₹2,499
            </Interactive.Div>
            <div style={{height: 1, backgroundColor: "rgba(255,255,255,0.10)", margin: "32px 0 24px"}} />
            <div style={{display: "grid", gridTemplateColumns: "1fr auto", rowGap: 15, fontSize: 19}}>
              <span style={{color: "#8f8b9c"}}>Member</span><span style={{color: "#ffffff", fontWeight: 640}}>Arjun Mehta</span>
              <span style={{color: "#8f8b9c"}}>Method</span><span style={{color: "#ffffff", fontWeight: 640}}>UPI · AutoPay</span>
              <span style={{color: "#8f8b9c"}}>Membership</span><span style={{color: "#ffffff", fontWeight: 640}}>Renewed</span>
            </div>
          </Interactive.Div>
        </div>
        <Interactive.Div
          name="Collection footer"
          style={{
            alignSelf: "flex-start",
            padding: "13px 18px",
            borderRadius: 999,
            color: "#c4b5fd",
            backgroundColor: "rgba(124,58,237,0.12)",
            fontSize: 21,
            fontWeight: 630,
            opacity: interpolate(frame, [68, 84], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Member status updates automatically
        </Interactive.Div>
      </div>
    </AbsoluteFill>
  );
};
