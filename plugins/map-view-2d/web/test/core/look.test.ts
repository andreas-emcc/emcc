import { describe, expect, it } from 'vitest';
import { FAKE_TOKEN_VALUES } from '@emc2/plugin-sdk/testing';
import { DEFAULT_TEXT_LOOK, sameTextLook, textLookFrom, tokenColour } from '../../src/core/look.ts';

describe('the text look from the tokens (brief function 21)', () => {
  it("takes the text colour, the ground colour as the halo, the text font and the data font", () => {
    expect(textLookFrom(FAKE_TOKEN_VALUES)).toEqual({
      text: [227, 232, 239, 1], halo: [15, 18, 23, 1], font: FAKE_TOKEN_VALUES.fontText, dataFont: FAKE_TOKEN_VALUES.fontData,
    });
  });

  it('keeps the default for a colour that is not #rrggbb and for an empty font', () => {
    const look = textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: 'red', colorGround: '', fontText: '  ', fontData: '' });
    expect(look).toEqual({ ...DEFAULT_TEXT_LOOK });
    expect(textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: ' #ABCDEF ', fontText: ' Arial ' })).toMatchObject({ text: [171, 205, 239, 1], font: 'Arial' });
  });

  it("reads the colours as the built shell CSS gives them: #rgb (Signal light's text #111111 becomes #111), rgb() and rgba() (review finding 1)", () => {
    expect(textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: '#111' }).text).toEqual([17, 17, 17, 1]);
    expect(tokenColour('#AbC')).toEqual([170, 187, 204, 1]);
    expect(tokenColour('rgb(21, 26, 33)')).toEqual([21, 26, 33, 1]);
    expect(tokenColour(' rgba(0,0,0,0.45) ')).toEqual([0, 0, 0, 0.45]);
    expect(tokenColour('rgba(0, 0, 0, 2)')).toEqual([0, 0, 0, 1]);
    for (const bad of ['#1111', '#11', 'rgb(256, 0, 0)', 'rgb(1, 2)', 'red', '', 'hsl(0, 0%, 0%)']) expect(tokenColour(bad)).toBeNull();
  });

  it('a change of density alone gives the same text look', () => {
    const compact = textLookFrom(FAKE_TOKEN_VALUES);
    const comfortable = textLookFrom({ ...FAKE_TOKEN_VALUES, sizeText: '14px', sizeTextSmall: '12px', sizeRow: '34px' });
    expect(sameTextLook(compact, comfortable)).toBe(true);
    expect(sameTextLook(compact, { ...compact, text: [227, 232, 239, 0.5] })).toBe(false);
    expect(sameTextLook(compact, { ...compact, halo: [16, 18, 23, 1] })).toBe(false);
    expect(sameTextLook(compact, { ...compact, font: 'serif' })).toBe(false);
    expect(sameTextLook(compact, { ...compact, dataFont: 'serif' })).toBe(false);
  });
});
