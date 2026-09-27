import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { ColorValue } from 'react-native';

import { Glyph, type GlyphName } from '../../../ui/glyph';
import { Text } from '../../../ui/text';
import type { NativeTemplateButton } from '../inbox-types';
import {
  previewSegments,
  previewText,
  type PreviewSegment,
  type TemplatePresentation,
  type TemplateValues,
} from '../template-presentation';

const BUTTON_GLYPH: Record<NativeTemplateButton['type'], GlyphName> = {
  QUICK_REPLY: 'arrowshape.turn.up.left',
  URL: 'arrow.up.right.square',
  PHONE_NUMBER: 'phone',
  COPY_CODE: 'doc.on.doc',
};

function Segments({ segments }: { segments: PreviewSegment[] }) {
  return segments.map((segment, index) =>
    segment.kind === 'missing' ? (
      <Text className="text-chat-meta-out" key={index}>
        {segment.text}
      </Text>
    ) : (
      segment.text
    )
  );
}

export interface TemplateMessagePreviewProps {
  presentation: TemplatePresentation;
  values: TemplateValues;
}

/**
 * The approved message drawn as the customer will receive it: an outgoing
 * bubble in the chat's own colours, with the template's buttons as the
 * divided rows WhatsApp puts under a business message. The reader checks the
 * real thing, not a form summary of it.
 */
export function TemplateMessagePreview({
  presentation,
  values,
}: TemplateMessagePreviewProps) {
  const metaOut = useCSSVariable('--color-chat-meta-out') as
    ColorValue | undefined;
  const { template } = presentation;
  const header =
    template.headerType === 'text' && template.headerContent
      ? template.headerContent
      : null;
  const spokenMessage = [
    header ? previewText(header, 'header', presentation, values) : null,
    previewText(template.bodyText, 'body', presentation, values),
    template.footerText,
    template.buttons.length > 0
      ? `Buttons: ${template.buttons.map((button) => button.text).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View className="items-end" testID="template-preview">
      <View
        accessibilityLabel={`Message preview: ${spokenMessage}`}
        accessible
        className="bg-chat-bubble-out max-w-[88%] overflow-hidden rounded-3xl"
      >
        <View className="gap-1 px-4 py-2.5">
          {header ? (
            <Text className="text-foreground text-base font-semibold">
              <Segments
                segments={previewSegments(
                  header,
                  'header',
                  presentation,
                  values
                )}
              />
            </Text>
          ) : null}
          <Text
            className="text-foreground text-base"
            testID="template-preview-body"
          >
            <Segments
              segments={previewSegments(
                template.bodyText,
                'body',
                presentation,
                values
              )}
            />
          </Text>
          {template.footerText ? (
            <Text className="text-chat-meta-out text-sm">
              {template.footerText}
            </Text>
          ) : null}
        </View>
        {template.buttons.map((button, index) => (
          <View
            className="border-border min-h-11 flex-row items-center justify-center gap-2 border-t px-4 py-2"
            key={`${button.type}:${index}`}
          >
            <Glyph
              name={BUTTON_GLYPH[button.type]}
              size={16}
              tintColor={metaOut}
            />
            <Text className="text-foreground text-sm font-medium">
              {button.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
