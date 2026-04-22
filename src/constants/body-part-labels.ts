import { BodyPartKey } from '@/types/portrait';

/**
 * 신체 부위 하나의 세 언어 이름 묶음
 */
type BodyPartLabelEntry = {
  ko: string;
  en: string;
  jp: string;
};

/**
 * * `BodyPartKey`를 키로, 세 언어 이름을 값으로 갖는 레이블 맵.
 * * 사용 예:
 *   `const label = BODY_PART_LABEL_MAP['eye'][currentLanguage];`
 */
export const BODY_PART_LABEL_MAP: Record<BodyPartKey, BodyPartLabelEntry> = {
  eye: { ko: '눈', en: 'eye', jp: '目' },
  eyebrow: { ko: '눈썹', en: 'brow', jp: '眉' },
  nose: { ko: '코', en: 'bose', jp: '鼻' },
  mouth: { ko: '입', en: 'mouth', jp: '口' },
  ear: { ko: '귀', en: 'ear', jp: '耳' },
  faceOval: { ko: '얼굴', en: 'face', jp: '顔' },
  skin: { ko: '피부', en: 'skin', jp: '肌' },
  hair: { ko: '머리', en: 'hair', jp: '髪' },
};
