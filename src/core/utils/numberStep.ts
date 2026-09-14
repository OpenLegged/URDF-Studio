interface DecimalParts {
  coefficient: bigint;
  scale: number;
}

const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i;

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

const parseFiniteDecimalString = (value: string): DecimalParts | null => {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const integerDigits = match[2] ?? '0';
  const fractionalDigits = match[3] ?? match[4] ?? '';
  const exponent = match[5] === undefined ? 0 : Number.parseInt(match[5], 10);
  if (!Number.isSafeInteger(exponent)) {
    return null;
  }

  const digits = `${integerDigits}${fractionalDigits}`.replace(/^0+(?=\d)/, '') || '0';
  let scale = fractionalDigits.length - exponent;
  let coefficient = BigInt(digits) * sign;

  if (scale < 0) {
    coefficient *= pow10(-scale);
    scale = 0;
  }

  return { coefficient, scale };
};

const decimalPartsToString = ({ coefficient, scale }: DecimalParts): string => {
  if (coefficient === 0n) {
    return '0';
  }

  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();

  if (scale === 0) {
    return `${sign}${digits}`;
  }

  const paddedDigits = digits.padStart(scale + 1, '0');
  const integerEnd = paddedDigits.length - scale;
  const integerPart = paddedDigits.slice(0, integerEnd);
  const fractionalPart = paddedDigits.slice(integerEnd).replace(/0+$/, '');

  return fractionalPart ? `${sign}${integerPart}.${fractionalPart}` : `${sign}${integerPart}`;
};

/**
 * Applies repeated numeric UI steps in decimal space before converting back to
 * JavaScript's `number`. This keeps explicit user-entered small offsets intact
 * while avoiding binary float tails such as `1.2000000000000002`.
 */
export const addNumberStep = (value: number, step: number, stepCount: number): number => {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(step) ||
    !Number.isFinite(stepCount) ||
    !Number.isSafeInteger(stepCount)
  ) {
    return value + step * stepCount;
  }

  if (stepCount === 0 || step === 0) {
    return value;
  }

  const valueParts = parseFiniteDecimalString(String(value));
  const stepParts = parseFiniteDecimalString(String(step));
  if (!valueParts || !stepParts) {
    return value + step * stepCount;
  }

  const scale = Math.max(valueParts.scale, stepParts.scale);
  const scaledValue = valueParts.coefficient * pow10(scale - valueParts.scale);
  const scaledStep = stepParts.coefficient * pow10(scale - stepParts.scale);
  const steppedValue = scaledValue + scaledStep * BigInt(stepCount);

  return Number(decimalPartsToString({ coefficient: steppedValue, scale }));
};
