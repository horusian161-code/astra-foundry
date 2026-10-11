# Astra UI Kit — реализованный слой alpha 0.3

Это небольшой рабочий слой компонентов, управления фокусом и DOM-переходов.
Он не импортирует Foundry, CPR, `OperationEngine`, правила оружия или хранилище.
Нет редактора Studio, canvas-эффектов или готового универсального
набора форм. Это граница текущего кода, а не перечень обещанных функций.

## Реальные потребители

| Общий код | Потребитель |
|---|---|
| `renderPanelShell` / `renderAction` | Нативная панель подготовки REDLINE в `scripts/ui/preparation-panel.mjs` |
| Те же `renderPanelShell` / `renderAction` | Подготовка, защита, результат, GM, восстановление и настройки в `scripts/ui/workflow-render.mjs` |
| `renderPanelHeading` | Панель SDK и заголовки примеров интерактивного журнала / базы |
| `captureFocus` / `restoreFocus` | Перерисовка и закрытие контекстной панели в `scripts/demo/workflow-demo.mjs` |
| `MotionCoordinator` | Отменяемое появление панели демостенда, повторная перерисовка и очистка при закрытии страницы |

Структура и названия `.rl-*` / `.wf-*` сохранены. Темы, расположение панелей и цвета
задаются потребителями. `styles/ui-kit.css` содержит общий каркас заголовка, фокус и
отключение дублирующей CSS-анимации для панели с управляемым переходом.

## Рендер компонентов

```js
import {
  escapeText, renderedContent, renderPanelShell, renderAction
} from './scripts/ui-kit/index.mjs';

const html = renderPanelShell({
  title: playerSuppliedName,              // экранируется
  subtitle: 'Интерактивное досье',
  classes: {panel: 'dossier-panel', body: 'dossier-body'},
  body: renderedContent(
    text => `<p>${escapeText(text)}</p>`,   // доверенный renderer
    playerSuppliedText
  ),
  actions: [{
    label: 'Закрыть', action: 'close',
    actionAttribute: 'data-dossier-action',
    ariaLabel: 'Закрыть досье'
  }]
});
```

`renderPanelShell` принимает только специальный результат `renderedContent(renderer)`
для тела. Обычная HTML-строка и объект `{html: ...}` отклоняются.
`renderAction` экранирует `label`; для богатой подписи также нужен явный
`body: renderedContent(renderer)`. Атрибуты действий задаются структурированно;
`onclick`, `style` и произвольные исполняемые атрибуты отклоняются.

**Это не HTML-санитайзер.** `renderedContent` обозначает доверенный код renderer,
а не делает любой переданный HTML безопасным. Нельзя оборачивать непроверенное HTML
пользователя в `renderedContent(() => rawUserHTML)`. Текст и имена внутри собственного
renderer нужно экранировать. Импорт богатого HTML требует отдельной политики очистки,
которая здесь не реализована.

## Фокус без устаревших DOM-ссылок

```js
const bookmark = captureFocus(root, {
  attributes: ['id', 'data-dossier-field', 'data-dossier-action']
});
root.innerHTML = nextHTML;
restoreFocus(root, bookmark, {fallbackSelectors: ['[data-astra-panel]']});
```

Закладка содержит имя стабильного атрибута, его значение и, если доступно, положение
каретки. Старый DOM-элемент в ней отсутствует. После перерисовки находится новый
элемент внутри указанного root. Отсоединённые, скрытые, inert и отключённые назначения
не получают фокус. Если исходное поле исчезло, вызывающий код может задать резервные
селекторы. Положение каретки не переносится на чужое резервное поле.

Для закрытия сохраните закладку кнопки открытия относительно `document`, затем вызовите
`restoreFocus(document, openerBookmark, ...)`. В демостенде закрытие через кнопку или
Escape возвращает фокус к живой кнопке открытия; если её больше нет — к доступной
кнопке основной панели. Функции не эмулируют полный жизненный цикл ApplicationV1/V2.

## Отменяемый DOM-переход

```js
const motion = new MotionCoordinator();
// DOM уже показывает новое состояние. Результат операции НЕ ждёт анимацию.
void motion.play(panel, [
  {opacity: 0, transform: 'translateX(7px)'},
  {opacity: 1, transform: 'none'}
], {duration: 160}, {signal: windowAbort.signal, reduced: reducedMotion});

motion.cancelAll('rerender'); // перед заменой DOM
motion.dispose();            // закрытие окна / окончательное освобождение
```

`play` использует `Element.animate`; повторный вызов для того же элемента отменяет
предыдущий переход. AbortSignal отменяет ожидание и удаляет обработчик. Завершение,
отмена и `dispose` освобождают созданную анимацию и запись координатора. Режим уменьшенного
движения, отсоединённый элемент и отсутствие WAAPI дают немедленный `skipped`.

Ответы: `{state:'finished'}`, `{state:'cancelled', reason:...}` или
`{state:'skipped', reason:...}`. В API нет callback выполнения игровой операции.
Анимация не бросает кубик, не списывает ресурс и не завершает workflow последним кадром.
Canvas-эффекты к этому слою не относятся.

## Проверка и пределы

`tests/ui-kit.test.mjs` проверяет девять сценариев: границу HTML, подписи и атрибуты,
фактическое использование компонентов в REDLINE/журнале/базе, фокус после замены DOM,
отказ фокуса к недоступным элементам, повтор анимации, AbortSignal/dispose, reduced motion
и снятие подписки после завершения.

DOM и WAAPI здесь заменены небольшими тестовыми объектами. Эти тесты подтверждают
контракты и очистку, но не являются браузерной визуальной проверкой, снимком работающей
Foundry или проверкой размеров 1920×1080 / 1366×768. Живая проверка Foundry v12 и её
ApplicationV1-точек интеграции остаётся отдельным этапом.
