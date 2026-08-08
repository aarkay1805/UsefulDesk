import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { staticFile } from "remotion";
import { CollectScene } from "./scenes/CollectScene";
import { FinalScene } from "./scenes/FinalScene";
import { FollowUpScene } from "./scenes/FollowUpScene";
import { HookScene } from "./scenes/HookScene";
import { RenewalsScene } from "./scenes/RenewalsScene";
import { WhatsAppScene } from "./scenes/WhatsAppScene";

export const UsefulDeskPromo: React.FC = () => {
  return (
    <>
      <Audio src={staticFile("usefuldesk-promo-bed.wav")} volume={0.34} />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={105} name="Hook">
          <HookScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence durationInFrames={120} name="Renewals queue">
          <RenewalsScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence
          durationInFrames={120}
          name="WhatsApp reminder"
        >
          <WhatsAppScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence durationInFrames={120} name="UPI collection">
          <CollectScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence
          durationInFrames={120}
          name="Owned follow-up"
        >
          <FollowUpScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence
          durationInFrames={120}
          name="Final call to action"
        >
          <FinalScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </>
  );
};
