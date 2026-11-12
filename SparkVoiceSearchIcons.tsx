import React from 'react';

export const SPARK_VOICE_ICON_PACK_ASSET =
  '/assets/aistudio/Pack_d_ic_nes_vocales_modernes_en_d_grad__b86e9822.png';

interface SparkIconProps {
  className?: string;
  title?: string;
  'data-testid'?: string;
}

/**
 * Left icon from Pack_d_ic_nes_vocales_modernes_en_d_grad__b86e9822.png:
 * Circular blue-to-violet gradient badge with 5 white vertical voice waveform bars.
 * Exact pixel bounding box in 2172x724 sheet: x=341..770, y=145..570.
 */
export const SparkLiveWaveformIcon: React.FC<SparkIconProps> = ({
  className = 'w-6 h-6',
  title,
  'data-testid': testId,
}) => (
  <svg
    viewBox="337.5 139.5 436 436"
    className={` inline-block shrink-0 select-none ${className}`}
    role={title ? 'img' : 'presentation'}
    aria-label={title}
     aria-hidden={!title}
    data-testid={testId}
  >
    {title ? <title>{title}</title> : null}
    <image
      href={SPARK_VOICE_ICON_PACK_ASSET}
      width="2172"
      height="724"
      preserveAspectRatio="none"
    />
  </svg>
);

/**
 * Center icon from Pack_d_ic_nes_vocales_modernes_en_d_grad__b86e9822.png:
 * White magnifying glass outline with a 4-point blue-to-purple gradient AI sparkle star.
 * Exact pixel bounding box in 2172x724 sheet: x=936..1290, y=186..539.
 */
export const SparkAiSearchIcon: React.FC<SparkIconProps> = ({
  className = 'w-5 h-5',
  title,
  'data-testid': testId,
}) => (
  <svg
    viewBox="931 180.5 364 364"
    className={`inline-block shrink-0 select-none ${className}`}
    role={title ? 'img' : 'presentation'}
    aria-label={title}
    aria-hidden={!title}
    data-testid={testId}
  >
    {title ? <title>{title}</title> : null}
    <image
      href={SPARK_VOICE_ICON_PACK_ASSET}
      width="2172"
      height="724"
      preserveAspectRatio="none"
    />
  </svg>
);

/**
 * Right icon from Pack_d_ic_nes_vocales_modernes_en_d_grad__b86e9822.png:
 * Clean white studio microphone icon with rounded capsule, U-cradle, stem, and base.
 * Exact pixel bounding box in 2172x724 sheet: x=1512..1805, y=166..564.
 */
export const SparkVoiceMicIcon: React.FC<SparkIconProps> = ({
  className = 'w-5 h-5',
  title,
  'data-testid': testId,
}) => (
  <svg
    viewBox="1454.5 161 408 408"
    className={`inline-block shrink-0 select-none ${className}`}
    role={title ? 'img' : 'presentation'}
    aria-label={title}
    aria-hidden={!title}
    data-testid={testId}
  >
    {title ? <title>{title}</title> : null}
    <image
      href={SPARK_VOICE_ICON_PACK_ASSET}
      width="2172"
      height="724"
      preserveAspectRatio="none"
    />
  </svg>
);
