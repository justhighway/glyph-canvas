import { NextRequest, NextResponse } from 'next/server';

import type { BoundingBox } from '@/types';
import type { SceneDetection } from '@/types/scene';

/** Gemini가 반환하는 감지 결과 단위 */
type GeminiDetection = {
  label_ko: string;
  box_2d: [number, number, number, number]; // [y_min, x_min, y_max, x_max], 0~1000 정규화
};

/** /api/analyze-scene 요청 바디 */
type SceneAnalyzeRequest = {
  imageBase64: string;
  mimeType: string;
};

/** /api/analyze-scene 성공 응답 */
type SceneAnalyzeResponse = {
  sceneDetections: SceneDetection[];
};

/**
 * Gemini에게 보낼 프롬프트를 생성한다.
 * 응답 형식을 JSON으로 고정하고, 좌표는 0~1000 정규화값으로 요청한다.
 */
const buildSceneDetectionPrompt = (): string =>
  `이 이미지에서 인식되는 모든 사물/객체를 감지하고, 각 객체마다 한국어 이름과 bounding box를 반환해주세요.

응답은 반드시 아래 JSON 형식만 출력하세요. 다른 텍스트는 절대 포함하지 마세요.

[
  {
    "label_ko": "객체 한국어 이름",
    "box_2d": [y_min, x_min, y_max, x_max]
  }
]

좌표는 0~1000 사이 정수로 정규화합니다. (0 = 이미지 시작, 1000 = 이미지 끝)`;

/**
 * Gemini 응답에서 JSON 배열을 추출한다.
 * Gemini가 마크다운 코드 블록(```json ... ```)으로 감쌀 때를 처리한다.
 */
const extractJsonFromGeminiResponse = (text: string): string => {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
};

/**
 * Gemini 응답 배열에서 구조가 유효한 항목만 필터링한다.
 * 런타임에 예상치 못한 응답 형식이 들어올 때 앱이 크래시되지 않도록 방어한다.
 */
const filterValidDetections = (parsed: unknown): GeminiDetection[] => {
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (item): item is GeminiDetection =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).label_ko === 'string' &&
      Array.isArray((item as Record<string, unknown>).box_2d) &&
      ((item as Record<string, unknown>).box_2d as unknown[]).length === 4,
  );
};

/**
 * Gemini의 0~1000 정규화 좌표를 앱 도메인의 0~1 BoundingBox로 변환한다.
 * Gemini는 [y_min, x_min, y_max, x_max] 순서로 반환하므로 주의한다.
 */
const convertGeminiBoundingBox = (
  box2d: [number, number, number, number],
): BoundingBox => {
  const [yMin, xMin, yMax, xMax] = box2d;
  return {
    x: xMin / 1000,
    y: yMin / 1000,
    width: (xMax - xMin) / 1000,
    height: (yMax - yMin) / 1000,
  };
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: '서버 환경 변수 GEMINI_API_KEY가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  let body: SceneAnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: '요청 바디를 파싱하는 데 실패했습니다.' },
      { status: 400 },
    );
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    return NextResponse.json(
      { message: 'imageBase64와 mimeType이 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildSceneDetectionPrompt() },
                {
                  inlineData: {
                    mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            // JSON 형식으로만 응답하도록 설정
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return NextResponse.json(
        { message: 'Gemini API 호출에 실패했습니다.' },
        { status: 502 },
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText: string =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const jsonText = extractJsonFromGeminiResponse(rawText);
    const parsed: unknown = JSON.parse(jsonText);
    const validDetections = filterValidDetections(parsed);

    const sceneDetections: SceneDetection[] = validDetections.map(
      ({ label_ko, box_2d }) => ({
        labelKo: label_ko,
        boundingBox: convertGeminiBoundingBox(box_2d),
      }),
    );

    const responseBody: SceneAnalyzeResponse = { sceneDetections };
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('analyze-scene route error:', error);
    return NextResponse.json(
      { message: '이미지 분석 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
