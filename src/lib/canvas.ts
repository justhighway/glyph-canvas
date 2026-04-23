import { RGB } from '@/types';

/**
 * * Canvas에 그려진 이미지에서 픽셀 전체 RGBA 데이터를 추출하는 함수.
 * * 반환 값을 마스크/박스 영역의 평균 색상을 계산하는데 사용됨.
 *
 * @param canvas - 픽셀 데이터를 읽을 Canvas 엘리먼트
 * @returns 픽셀 RGBA 배열. Canvas가 비어 있으면 null.
 */
export const extractCanvasImageData = (
  canvas: HTMLCanvasElement,
): ImageData | null => {
  const context = canvas.getContext('2d');
  if (!context) return null;
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * sRGB 채널값(0~255)을 선형 빛 세기(0~1)로 변환한다.
 * 모니터 픽셀값은 감마 인코딩되어 있어 선형 값이 아니므로,
 * 평균을 내기 전에 선형 공간으로 변환해야 정확한 지각적 중간색이 나온다.
 */
const srgbToLinear = (channelValue: number): number => {
  const normalized = channelValue / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

/**
 * 선형 빛 세기(0~1)를 sRGB 채널값(0~255)으로 재변환한다.
 */
const linearToSrgb = (linear: number): number => {
  const encoded =
    linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(encoded * 255, 0), 255));
};

/**
 * RGBA ImageData에서 지정한 픽셀 인덱스들의 평균 RGB를 계산하는 함수.
 * 선형 빛 세기 공간에서 평균을 낸 뒤 sRGB로 재변환한다.
 *
 * 단순 선형 평균(픽셀값 그대로 더하기)은 감마 인코딩 때문에
 * 결과가 실제 지각 중간색보다 어둡게 나온다.
 * 선형 공간 평균이 눈이 느끼는 실제 색에 가장 가깝다.
 *
 * @param imageData - Canvas 전체 픽셀 데이터
 * @param pixelIndices - 평균을 낼 픽셀의 1차원 인덱스 배열 (y * width + x)
 * @returns 선형 공간 평균 후 sRGB 재변환한 RGB. 픽셀이 없으면 회색(128, 128, 128).
 */
export const calculateAverageRgbFromPixelIndices = (
  imageData: ImageData,
  pixelIndices: number[],
): RGB => {
  if (pixelIndices.length === 0) return { r: 128, g: 128, b: 128 };

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  for (const pixelIndex of pixelIndices) {
    const byteOffset = pixelIndex * 4;
    // 선형 공간으로 변환한 뒤 합산해야 평균이 지각적으로 정확하다
    totalR += srgbToLinear(imageData.data[byteOffset]);
    totalG += srgbToLinear(imageData.data[byteOffset + 1]);
    totalB += srgbToLinear(imageData.data[byteOffset + 2]);
  }

  const count = pixelIndices.length;
  return {
    r: linearToSrgb(totalR / count),
    g: linearToSrgb(totalG / count),
    b: linearToSrgb(totalB / count),
  };
};

/**
 * 해당 영역의 평균 RGB를 그대로 글자 색상으로 반환한다.
 * 각 신체 부위의 실제 픽셀 색을 글자에 그대로 입혀
 * 글자 그림이 원본 이미지의 색감을 그대로 재현하도록 한다.
 *
 * @param averageRgb - 해당 영역의 평균 RGB
 * @returns 해당 영역 픽셀 색을 그대로 반영한 글자 색상
 */
export const deriveContrastingGlyphColor = (averageRgb: RGB): RGB => averageRgb;

/**
 * RGB 객체를 Canvas fillStyle에 바로 쓸 수 있는 CSS 색상 문자열로 변환하는 함수
 */
export const rgbToCssColor = ({ r, g, b }: RGB): string =>
  `rgb(${r}, ${g}, ${b})`;
