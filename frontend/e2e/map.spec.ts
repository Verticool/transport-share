import { expect, test } from '@playwright/test';

import { parkSummary, openFreeScooter, signIn, RIDES_LINK } from './helpers';

/**
 * Сквозные проверки фронта на мок-данных.
 *
 * Ходим по приложению ссылками и кнопками, а не перезагрузками: на мок-стадии состояние «сервера»
 * живёт в памяти вкладки (см. `docs/evidence/S6/account-acceptance.txt`), поэтому перезагрузка
 * страницы посередине сценария сбросила бы созданные данные. На S11 ограничение снимается, и
 * переходы по URL станут равнозначны.
 */
test.describe('карта парка', () => {
  test('показывает 40 самокатов, зону обслуживания и подпись источника', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Карта самокатов' })).toBeVisible();
    await expect(page.getByText(/\d+ свободны из 40 в зоне обслуживания/)).toBeVisible();
    await expect(page.getByText('Tiles © Esri — Esri, DeLorme, NAVTEQ')).toBeVisible();

    const rows = page.getByTestId('park-list').getByRole('button');
    await expect(rows).toHaveCount(40);
  });

  test('карточка самоката показывает состояние, заряд и расстояние', async ({ page }) => {
    await page.goto('/');

    const code = await openFreeScooter(page);
    const card = page.getByTestId('scooter-card');

    await expect(card).toBeVisible();
    await expect(card.getByText(`Самокат ${code}`)).toBeVisible();
    await expect(card.getByText('Свободен')).toBeVisible();
    await expect(card.getByText(/\d+ %/)).toBeVisible();
    await expect(card.getByText(/\d+([.,]\d+)? (м|км)/)).toBeVisible();
  });

  test('все точки парка видны всегда, и об этом сказано на панели', async ({ page }) => {
    await page.goto('/');

    // Требование стенда: парк показан целиком, в том числе во время поездки — так проверяются
    // сценарии. Пользователь должен понимать, что это отступление от рабочего приложения.
    await expect(page.getByTestId('park-visibility-note')).toContainText('Парк показан целиком');
    await expect(page.getByTestId('park-visibility-note')).toContainText('только ваш самокат и зона');
    await expect(page.getByTestId('park-list').getByRole('button')).toHaveCount(40);
  });

  test('клик по пустому месту карты снимает выделение, а перетаскивание — нет', async ({ page }) => {
    await page.goto('/');

    const code = await openFreeScooter(page);
    const card = page.getByTestId('scooter-card');
    await expect(card).toContainText(`Самокат ${code}`);

    const viewport = page.locator('.ol-viewport');
    const box = await viewport.boundingBox();
    if (box === null) {
      throw new Error('карта не заняла место на странице');
    }

    // Перетаскивание: карту двигают, отпускают в другой точке. Браузер присылает то же событие
    // клика, но выделение снимать нельзя — пользователь смотрел город, а не сбрасывал выбор.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 + 80, box.y + box.height * 0.5 + 40, { steps: 8 });
    await page.mouse.up();
    await expect(card).toBeVisible();

    // Обычный клик по свободному от маркеров месту: выделение снимается, карточка закрывается.
    // Берём угол карты — там нет ни зоны, ни самокатов парка.
    await page.mouse.click(box.x + 6, box.y + 6);
    await expect(card).toHaveCount(0);
  });

  test('выбранный на карте самокат виден в списке: список подводится к строке', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('park-list').getByRole('button').first()).toBeVisible();

    const viewport = page.locator('.ol-viewport');
    const box = await viewport.boundingBox();
    if (box === null) {
      throw new Error('карта не заняла место на странице');
    }

    // Ищем маркер так же, как его находит пользователь: курсор над точкой становится указателем.
    let clicked = false;
    const stepX = (box.width - 80) / 14;
    const stepY = (box.height - 80) / 10;
    for (let row = 0; row < 10 && !clicked; row += 1) {
      for (let column = 0; column < 14 && !clicked; column += 1) {
        const x = Math.round(box.x + 40 + column * stepX);
        const y = Math.round(box.y + 40 + row * stepY);
        await page.mouse.move(x, y);
        if (await viewport.evaluate((element) => element.style.cursor === 'pointer')) {
          await page.mouse.click(x, y);
          clicked = true;
        }
      }
    }
    expect(clicked, 'на карте должен найтись маркер').toBe(true);

    // Список отсортирован по удалённости и прокручивается: выбранная строка обязана быть в виде,
    // иначе непонятно, что открыто в панели (ровно на это и жаловались).
    const list = page.getByTestId('park-list');
    const listBox = await list.boundingBox();
    const rowBox = await list.locator('[aria-current="true"]').boundingBox();
    if (listBox === null || rowBox === null) {
      throw new Error('список или выбранная строка не найдены');
    }
    expect(rowBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
  });

  test('на телефоне ничего не уезжает за экран: хедер, карта и панель парка', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('park-list').getByRole('button').first()).toBeVisible();

    // Горизонтального переполнения быть не должно: на этой ширине уезжала кнопка входа и часть панели.
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

    // Карта занимает верхнюю часть экрана, панель — остальное, обе видны целиком.
    const map = await page.getByTestId('map-canvas').boundingBox();
    const list = await page.getByTestId('park-list').boundingBox();
    if (map === null || list === null) {
      throw new Error('карта или список не найдены');
    }
    expect(map.height).toBeGreaterThan(180);
    expect(map.y + map.height).toBeLessThanOrEqual(844);
    expect(list.height).toBeGreaterThan(60);

    // Шапка колонок не переносится: подписи совпадают с числами.
    await expect(page.getByTestId('park-list-header')).toContainText('До центра');
  });

  test('панель парка считает сводку по статусам', async ({ page }) => {
    await page.goto('/');

    const summary = await parkSummary(page);
    expect(summary.total).toBe(40);
    expect(summary.free + summary.reserved + summary.inRide + summary.unavailable).toBe(40);
  });

  test('клик по маркеру на карте открывает карточку самоката', async ({ page }) => {
    await page.goto('/');
    // Ждём парк: в режиме сервера он приходит потоком, в режиме моков — запросом.
    // Признак один: в списке появилась хотя бы одна строка самоката.
    await expect(page.getByTestId('park-list').getByRole('button').first()).toBeVisible();

    const viewport = page.locator('.ol-viewport');
    const box = await viewport.boundingBox();
    if (box === null) {
      throw new Error('карта не заняла место на странице');
    }

    // Маркер ищется так же, как его находит пользователь: курсор над точкой становится указателем.
    // Координаты не зашиты в тест — иначе он ломался бы при любом изменении вида карты.
    let clicked: { x: number; y: number } | null = null;
    const stepX = (box.width - 80) / 14;
    const stepY = (box.height - 80) / 10;
    for (let row = 0; row < 10 && clicked === null; row += 1) {
      for (let column = 0; column < 14 && clicked === null; column += 1) {
        const x = Math.round(box.x + 40 + column * stepX);
        const y = Math.round(box.y + 40 + row * stepY);
        await page.mouse.move(x, y);
        const pointer = await viewport.evaluate((element) => element.style.cursor === 'pointer');
        if (pointer) {
          await page.mouse.click(x, y);
          clicked = { x, y };
        }
      }
    }

    expect(clicked, 'на карте должен найтись хотя бы один маркер под курсором').not.toBeNull();

    const card = page.getByTestId('scooter-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/SC-\d{3}/);
    // Карточка — тот же вход в броню, что и строка списка: из неё видно действие.
    // Без входа действие предлагается ссылкой «Войти, чтобы забронировать», после входа — кнопкой.
    await expect(
      card.getByRole('button', { name: 'Забронировать' }).or(card.getByRole('link', { name: /Войти/ })),
    ).toBeVisible();
  });
});

test.describe('вход и защищённые экраны', () => {
  test('без входа кабинет не открывается, после входа — открывается', async ({ page }) => {
    await page.goto('/rides');

    await expect(page.getByRole('heading', { name: 'Вход в Движ' })).toBeVisible();

    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Парк' })).toBeVisible();

    await page.getByRole('link', { name: RIDES_LINK }).click();
    await expect(page.getByRole('heading', { name: 'Поездки' })).toBeVisible();
    await expect(page.getByText(/Всего поездок: \d+/)).toBeVisible();
  });
});
