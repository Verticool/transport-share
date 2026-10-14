import { expect, test } from '@playwright/test';

import { DEMO, ensureIdle, pickFreeScooter, signIn } from './helpers';

/**
 * Выезд за границу зоны обслуживания на живом стеке.
 *
 * Вне зоны самокат не тянет, а поездка продолжает тарифицироваться — это состояние легко не
 * заметить, если смотреть на карту. Поэтому проверяем, что оно появляется полосой под хедером и
 * всплывающим оповещением, а возвращение в зону сообщает о разблокировке.
 *
 * Самокат уезжает кнопками руля с крупным шагом (200 м): до границы около 4 км, то есть порядка
 * двадцати нажатий. Ждать симулятор не нужно — движение инициируется интерфейсом.
 */
test('выезд из зоны: полоса и всплывающее оповещение, возврат — сообщение о разблокировке', async ({ page }) => {
  test.setTimeout(180_000);

  await signIn(page, DEMO);
  await ensureIdle(page);
  await pickFreeScooter(page);

  await page.getByTestId('scooter-card').getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByTestId('booking-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Начать поездку' }).click();
  await expect(page.getByTestId('ride-panel')).toBeVisible();

  // Крупный шаг: 20 м по умолчанию — это двести нажатий до границы.
  const step = page.getByTestId('steer-step');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await step.innerText()).includes('200')) {
      break;
    }
    await step.click();
  }
  await expect(step).toContainText('200');

  const banner = page.getByTestId('status-banner-outside-zone');
  // До движения самокат в зоне: иначе проверка ниже ничего не доказывала бы.
  await expect(banner).toHaveCount(0);

  const directions = ['На север', 'На восток'];
  let leftZone = false;
  let presses = 0;
  let usedDirection = '';
  let pressesInZone = 0;

  for (const direction of directions) {
    for (let press = 0; press < 26; press += 1) {
      await page.getByRole('button', { name: direction }).click();
      presses += 1;
      pressesInZone += 1;
      if (await banner.isVisible().catch(() => false)) {
        leftZone = true;
        usedDirection = direction;
        break;
      }
    }
    if (leftZone) {
      break;
    }
  }

  expect(leftZone, 'самокат должен оказаться вне зоны обслуживания').toBe(true);
  // До границы около четырёх километров: один-два нажатия её не достигают, значит проверка
  // действительно про выезд, а не про самокат, стоявший у границы.
  expect(presses).toBeGreaterThan(3);
  await expect(banner).toContainText('Вы выехали из зоны обслуживания');
  await expect(page.getByTestId('toast-outside-zone')).toBeVisible();
  // Панель поездки тоже объясняет, почему мотор не тянет и что делать.
  await expect(page.getByTestId('outside-zone')).toBeVisible();
  // Снимок состояния для отчёта: полоса под хедером, всплывающее оповещение и блок в панели.
  await page.screenshot({ path: 'test-results/outside-zone.png', fullPage: false });

  // Возвращаемся тем же маршрутом и тем же числом шагов (плюс запас): идти назад «наугад» долго,
  // а всплывающее оповещение о разблокировке живёт считанные секунды и легко проскакивает.
  const backToast = page.getByTestId('toast-back-in-zone');
  const backDirection = usedDirection === 'На север' ? 'На юг' : 'На запад';
  let returned = false;
  for (let press = 0; press < pressesInZone + 3; press += 1) {
    await page.getByRole('button', { name: backDirection }).click();
    if (await backToast.isVisible().catch(() => false)) {
      returned = true;
      break;
    }
  }

  expect(returned, 'возвращение в зону должно быть отмечено').toBe(true);
  await expect(backToast).toContainText('Снова в зоне обслуживания');
  await expect(banner).toHaveCount(0);

  // Убираем за собой: живая база переживает прогон, и открытая поездка ломала бы следующие
  // сценарии — они начинались бы с занятым аккаунтом.
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('ride-panel')).toHaveCount(0, { timeout: 20_000 });
});
