import { BODY_PART_LABEL_MAP } from '@/constants/body-part-labels';
import type { BodyPartKey } from '@/types/portrait';
import type { Language } from '@/types';

/**
 * BodyPartKey와 언어 코드를 받아 해당 신체 부위의 레이블 문자열을 반환한다.
 *
 * @param bodyPartKey - 조회할 신체 부위 식별자
 * @param language - 반환할 언어 ('ko' | 'en' | 'jp')
 * @returns 해당 언어의 신체 부위 이름
 */
export const getBodyPartLabel = (
  bodyPartKey: BodyPartKey,
  language: Language,
): string => BODY_PART_LABEL_MAP[bodyPartKey][language];
