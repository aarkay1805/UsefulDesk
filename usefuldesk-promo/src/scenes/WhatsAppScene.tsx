import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import {ArrowIcon, Brand, CheckIcon, SceneBackground, WhatsappIcon} from "../components";

export const WhatsAppScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: "#0d0d14", overflow: "hidden"}}>
      <SceneBackground accent="green" />
      <div style={{position: "absolute", inset: "70px 80px", display: "flex", flexDirection: "column"}}>
        <Brand compact />
        <Interactive.Div
          name="WhatsApp headline"
          style={{
            marginTop: 66,
            color: "#ffffff",
            fontSize: 73,
            lineHeight: 1.02,
            fontWeight: 780,
            letterSpacing: "-0.055em",
            maxWidth: 880,
            opacity: interpolate(frame, [0, 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          One tap. The right WhatsApp reminder.
        </Interactive.Div>
        <div style={{flex: 1, display: "grid", gridTemplateColumns: "0.9fr 90px 1.15fr", alignItems: "center", gap: 20}}>
          <Interactive.Div
            name="Reminder action"
            style={{
              padding: "30px 28px",
              borderRadius: 28,
              border: "1px solid rgba(255,255,255,0.11)",
              backgroundColor: "rgba(25,25,35,0.94)",
              opacity: interpolate(frame, [10, 28], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [10, 28], ["-36px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
              <div style={{fontSize: 20, color: "#8f8b9c", fontWeight: 600}}>Arjun Mehta</div>
              <div style={{fontSize: 17, color: "#fbbf24", fontWeight: 650}}>Expires today</div>
            </div>
            <div style={{fontSize: 34, lineHeight: 1.15, color: "#ffffff", fontWeight: 730, letterSpacing: "-0.035em", marginTop: 20}}>Strength · Monthly</div>
            <div style={{fontSize: 24, color: "#aaa6b6", marginTop: 12, fontVariantNumeric: "tabular-nums"}}>Renewal fee · ₹2,499</div>
            <div style={{height: 64, borderRadius: 18, backgroundColor: "#7c3aed", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 23, fontWeight: 690, marginTop: 32, boxShadow: "0 18px 50px rgba(124,58,237,0.24)"}}>
              <WhatsappIcon size={26} />
              Send reminder
            </div>
          </Interactive.Div>
          <Interactive.Div
            name="Flow arrow"
            style={{
              display: "flex",
              justifyContent: "center",
              color: "#8b5cf6",
              opacity: interpolate(frame, [28, 44], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [28, 44], ["-18px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <ArrowIcon />
          </Interactive.Div>
          <Interactive.Div
            name="WhatsApp phone"
            style={{
              height: 520,
              borderRadius: 42,
              padding: 14,
              border: "1px solid rgba(255,255,255,0.14)",
              backgroundColor: "#161620",
              boxShadow: "0 46px 100px rgba(0,0,0,0.42)",
              opacity: interpolate(frame, [34, 50], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              scale: interpolate(frame, [34, 56], [0.92, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({damping: 200}),
                output: "perceptual-scale",
              }),
            }}
          >
            <div style={{height: "100%", borderRadius: 31, overflow: "hidden", background: "linear-gradient(160deg,#efeae2 0%,#e7ded4 100%)"}}>
              <div style={{height: 76, display: "flex", alignItems: "center", gap: 13, padding: "0 20px", color: "#ffffff", backgroundColor: "#075e54"}}>
                <div style={{width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#7c3aed", fontSize: 15, fontWeight: 760}}>AM</div>
                <div>
                  <div style={{fontSize: 18, fontWeight: 680}}>Arjun Mehta</div>
                  <div style={{fontSize: 13, opacity: 0.78}}>online</div>
                </div>
              </div>
              <div style={{padding: 20, display: "flex", justifyContent: "flex-end", alignItems: "flex-end", height: 410}}>
                <Interactive.Div
                  name="Renewal message"
                  style={{
                    width: 310,
                    padding: "17px 18px 13px",
                    borderRadius: "18px 18px 5px 18px",
                    color: "#232323",
                    backgroundColor: "#d9fdd3",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                    fontSize: 17,
                    lineHeight: 1.42,
                    opacity: interpolate(frame, [48, 66], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                    translate: interpolate(frame, [48, 66], ["0px 32px", "0px 0px"], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                >
                  Hi Arjun, your Strength membership expires today. Renew now for <strong>₹2,499</strong> to keep training.
                  <div style={{display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 5, color: "#668a75", fontSize: 12}}>
                    9:02 AM <span style={{color: "#23a8e0"}}><CheckIcon size={17} /></span>
                  </div>
                </Interactive.Div>
              </div>
            </div>
          </Interactive.Div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
