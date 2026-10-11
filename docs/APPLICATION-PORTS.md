# Application-порты · alpha 0.3

REDLINE использует V1 `Application`: `activateListeners(html)` получает jQuery-обёртку, отдельный DOM Scope хранит обработчики. Закрытие освобождает DOM, Hooks контроллера, таймер обновления и переходы. Повторное открытие создаёт новые scopes. Общие focus bookmarks не держат старый элемент; переход не исполняет игровое действие.

SDK предоставляет **отдельный** `createV2PanelClass` в `scripts/core/application-v2-port.mjs`. Он наследуется от переданного `foundry.applications.api.ApplicationV2`, а не подменяет жизненный цикл V1. Используются документированные v12 `_prepareContext`, `_renderHTML`, `_replaceHTML(result,content,options)` и публичный `close`.

```js
const api = game.modules.get('astra-redline-combat').api;
const DossierPanel = api.sdk.createV2PanelClass({
  ApplicationV2: foundry.applications.api.ApplicationV2,
  context: async () => ({ title: 'Досье' }),
  render: data => api.components.renderPanelHeading({title: data.title}),
  bind: ({root,scope}) => {
    scope.listen(root,'click',event => { /* trusted module handler */ });
  }
});
```

`render` — доверенный код модуля, возвращающий HTML-строку; содержимое документов должно экранироваться компонентами. `bind` синхронный; возврат cleanup-функции необязателен. Async binder запрещён, его отклонение обрабатывается; не используйте пользовательские скрипты как binder. Scope каждого DOM-рендера освобождается перед заменой. V2 может поставить close за ожидающим render: поэтому cleanup выполняется **до и после** `await super.close`, включая отказ закрытия.

Фактически проверено: Node mock-base/DOM тесты, очистка при повторном рендере и закрытии, отказ binder, rejected async binder, queued render→close, повторное открытие. **Не проверено:** создание этой V2-панели внутри настоящего Foundry, позиционирование и поведение базового window chrome. Порт является прототипом интеграции, не live-сертификацией v12.

Первичный источник: https://foundryvtt.com/api/v12/classes/foundry.applications.api.ApplicationV2.html
