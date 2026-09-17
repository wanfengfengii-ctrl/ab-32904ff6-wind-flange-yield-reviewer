import { expect, test } from '@playwright/test';

/** 生成三段折线 JSON：空转 b1、弹性 b2、屈服 b3（均为整数毫度/毫牛米）。 */
function curve(b1: number, b2: number, b3: number, n = 24) {
  const points = [];
  for (let k = 0; k < n; k++) {
    const seg = k < 8 ? 0 : k < 16 ? 1 : 2;
    const b = [b1, b2, b3][seg];
    points.push({ angle: k * 10, torque: b * k * 10 + 5 });
  }
  return {
    curve: { name: `E2E-${b1}-${b2}-${b3}`, points },
    threshold: { slope_min: '0.1', slope_max: '10', yield_ratio_max: '0.5' },
  };
}

test.describe('法兰螺栓复核台联调', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('合法曲线：i/j、斜率、残差与 API 一致，并叠绘分界与三条拟合线', async ({ page }) => {
    await page.getByLabel('上传曲线 JSON').setInputFiles({
      name: 'ok.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(curve(2, 5, 1))),
    });
    await page.getByTestId('analyze-btn').click();

    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveText(/放行/);

    const result = page.getByTestId('result');
    await expect(result).toContainText('8');
    await expect(page.getByTestId('slope-0')).toHaveText('2');
    await expect(page.getByTestId('slope-1')).toHaveText('5');
    await expect(page.getByTestId('slope-2')).toHaveText('1');
    await expect(page.getByTestId('residual-1')).toHaveText('0');
    await expect(result).toContainText('0.2'); // b3/b2

    // SVG 叠绘：原始折线 + i/j 分界 + 三段拟合线
    await expect(page.getByTestId('raw-line')).toBeVisible();
    await expect(page.locator('[data-testid="boundary-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="boundary-1"]')).toBeVisible();
    for (const k of [0, 1, 2]) {
      await expect(page.locator(`[data-testid="fit-line-${k}"]`)).toBeVisible();
    }
  });

  test('早屈服（b3/b2 超限）：拒绝放行', async ({ page }) => {
    // b3=4，比值 0.8 > 0.5；但 b3<b2 仍成立，唯一失败项为屈服比
    await page.getByLabel('上传曲线 JSON').setInputFiles({
      name: 'early.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(curve(2, 5, 4))),
    });
    await page.getByTestId('analyze-btn').click();

    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveText(/拒绝/);
    await expect(page.getByTestId('result')).toContainText('0.8');
  });

  test('非法输入 422：列出全部 JSON Pointer 错误，不绘制任何拟合线', async ({ page }) => {
    const bad = curve(2, 5, 1);
    // 制造两类错误：angle 非严格递增、阈值下界非正
    bad.curve.points[3].angle = bad.curve.points[2].angle;
    bad.threshold.slope_min = '0';

    await page.getByLabel('上传曲线 JSON').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bad)),
    });
    await page.getByTestId('analyze-btn').click();

    const errors = page.getByTestId('error-list');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText('/curve/points/3/angle');
    await expect(errors).toContainText('/threshold/slope_min');
    await expect(errors).toContainText('422');

    // 原始曲线仍在，拟合线与分界一律不画
    await expect(page.getByTestId('raw-line')).toBeVisible();
    await expect(page.locator('[data-testid="fit-line-0"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="boundary-0"]')).toHaveCount(0);
    await expect(page.getByTestId('result')).toHaveCount(0);
  });
});
