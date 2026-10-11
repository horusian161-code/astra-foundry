# Astra Foundry · REDLINE COMBAT
## 0.3.0-alpha.1 — единый тестовый модуль для Foundry v12

**Предварительная сборка, не production-ready.** Код и упаковка проверены локально; установка, рендер внутри Foundry и многопользовательские действия ещё не прошли живую приёмку. Рабочий мир не изменялся. Предыдущие alpha сохранены.

Одна установка `astra-redline-combat` содержит общие библиотеки Astra SDK, UI-kit и HUD REDLINE. Studio, сторонние модули и новые редакторы на клиенте не требуются. Отдельный SDK ZIP устанавливать не нужно.

### Что можно тестировать сейчас

| Среда | Реально работает в коде | Не включено |
|---|---|---|
| Foundry v12, CPR | Чтение штатных Combat/Combatant, очередь, выбранный owned токен, видимые цели; HP/броня/оружие владельца; подготовка обычного single-профиля; контекстные панели; настройки клиента; штатный лист/трекер | Настоящие броски, автоматическое применение урона и расхода, сокеты защиты, native nextTurn, NET-автоматизация |
| Самостоятельный HTML | Полный демонстрационный путь подготовка→защита→результат→применение один раз→следующий ход; local IndexedDB ledger; GM/NET-представления; примеры журнала и базы | Реальные CPR броски, общий сервер, неизвестные NET-этажи или настоящие игровые документы |
| SDK для разработчика | OperationEngine/OperationService, строгие запросы, повторная проверка principal, CAS/lease/fence, сроки и сверка receipts, Memory/IndexedDB; панели/фокус/отмена DOM-анимаций; отдельный V2-порт | Серверная аутентификация, выбранный GM как вечный сервер, распределённый транспорт, универсальный undo |

**Кнопки настоящего исполнения не разблокируются из демонстрации.** `nativeRoll=false`, `damageApply=false`, `ammoChange=false`, `nextTurn=false`. NativeActionPort изучает точные профили официальных CPR v0.89.2/v0.92.4, но оба являются только source-study: prepare/execute возвращают объяснимый blocked; отдельный fallback открывает родной лист.

### Установка вручную

1. Сделайте резервную копию и используйте **отдельный тестовый мир**, не рабочий мир.
2. Остановите Foundry. Распакуйте `astra-redline-combat-0.3.0-alpha.1.zip` в `Data/modules`. Должен получиться путь `Data/modules/astra-redline-combat/module.json` — без двойного вложения.
3. Запустите Foundry v12 и тестовый CPR-мир. В «Управлении модулями» включите **Astra Foundry · REDLINE COMBAT**.
4. HUD открывается при входе; `Shift+H` или кнопка с прицелом в инструментах токенов показывают/скрывают его. Для SDK-only отключите клиентское «открывать HUD при входе».
5. Выберите свой токен и видимую цель. Откройте подготовку, укажите подтверждённую дистанцию, данные оружия и проверенные модификаторы. Предпросмотр не расходует патроны.
6. Бросок и изменение ресурсов делайте **родными средствами системы**. HUD не применяет произвольное изменение HP.

Штатный трекер и лист остаются резервным путём. Preferences/autoOpen имеют client scope. Alpha не пишет Actor/Item/Combat/мировые flags; это ограничение текущего собственного кода, а не гарантия поведения всех сторонних Hooks.

### GitHub prerelease и установка через manifest

Выбранный репозиторий: `https://github.com/horusian161-code/astra-foundry`.
Канал этой версии — **alpha prerelease**, тег `v0.3.0-alpha.1`; он не означает live-приёмку.
Versioned manifest для поля «Manifest URL» в Setup → Add-on Modules → Install Module:

`https://github.com/horusian161-code/astra-foundry/releases/download/v0.3.0-alpha.1/module.json`

После фактической публикации откройте этот manifest, проверьте ID `astra-redline-combat`
и версию `0.3.0-alpha.1`, затем установите и включите модуль только в отдельном CPR-мире.
Если адрес возвращает 404, выпуск ещё недоступен; используйте локальную установку ZIP.
Подготовленные URL сами по себе не доказывают существование репозитория или release.
`releases/latest` не используется: он не выбирает prerelease. Совместимость: minimum 12,
maximum 12.999; `verified` намеренно не указан.

### Самостоятельный демонстрационный стенд

Откройте `tools/REDLINE-Workflow-Alpha-0.3.html` обычным браузером. Самодостаточный HTML без внешних запросов, imports и assets. Данные демонстрационные. Результат создаётся только после выбора защиты. Отдельные режимы показывают игрока, GM, NET, ошибки/ожидание/неопределённость; можно отключить движение, проверить пустой магазин, смену персонажа и большое число участников.

Хранение HTML-демо локально в браузере, **не общая база Foundry**. Если браузер ограничивает IndexedDB для локальных файлов, стенд сообщает об отсутствии хранения; не считается проверкой переподключения двух клиентов. Полный NET-процесс не реализован.

### API и переиспользование

```js
const astra = game.modules.get('astra-redline-combat').api;
const snapshot = astra.snapshot();             // текущая разрешённая read projection
const catalog = astra.catalog();               // восемь read/UI/preview операций
const { OperationEngine, createService } = astra.sdk;
const service = createService({ engine });     // trusted module engine; game.user разрешается заново
await service.prepare({requestId, operation, args}); // caller не задаёт role/userId/rights
```

Raw SDK — доверенный код другого модуля, не канал удалённой аутентификации. Доменные adapters задают permission, execute/reconcile и гарантии receipt. `OperationService` не отдаёт authority records. Идентификатор запроса должен быть уникален; повторный запрос с иным payload отклоняется.

Интерактивный журнал и панель базы используют то же ядро и компоненты, а не дублирование REDLINE. Их данные — memory demos; настоящие JournalEntryPage и базы-сцены ещё не подключены. В будущем consuming-модуль требует один `astra-redline-combat` через `relationships.requires`; API alpha пока не обещает semver-стабильности.

### Проверки и сборка

```bash
npm ci
npm test
npm run check
npm run build
npm run preview:workflow
```

Node ≥20, Python ≥3.10; esbuild 0.25.12 — только dev tool для HTML, не runtime-зависимость. В прежней ограниченной локальной среде npm ci не скачал отсутствующий cache tarball; тесты/проверка исходников работают без node_modules, HTML пересобирается с уже доступным pinned esbuild. Успешное выполнение GitHub CI для этой публикационной копии ещё не подтверждено.

Сборка детерминирована: один runtime ZIP, SHA256 и индекс файлов `dist/build-manifest.json`. Tests/docs/tools не устанавливаются в Foundry; они доступны в исходном проекте. Source-pattern guard не является формальным доказательством безопасности.

### Документы

- `docs/SDK-SERVICE.md`, `docs/UI-KIT.md`, `docs/APPLICATION-PORTS.md` — реальные контракты и lifecycle.
- `docs/NATIVE-ACTION-PORT.md` — первичные источники CPR и причины отключённого исполнения.
- `docs/SINGLE-PACKAGE.md` — сборка и alpha/stable release-пути.
- `docs/REDLINE-Alpha-0.3-Report.md` — результаты, архитектура и оставшиеся блокеры.
- `docs/validation-tests.txt`, `docs/validation-source.txt` — фактические локальные проверки.
- `docs/readiness.example.json` — незаполненный шаблон evidence; не свидетельство готовности.

Архивные отчёты alpha 0.2 описывают тот этап, не обновлённую приёмку. Не подменяйте живую проверку synthetic release-gate fixtures.

### Безопасная приёмка следующего этапа

Нужны точная установленная сборка CPR/Foundry, изолированная LAB-сцена, GM+player два клиента, реальные системные attack/reload/damage/cancel outcomes, повторное нажатие/смена токена/переподключение и receipts. Также русский текст, длинные названия, 1920×1080/1366×768, масштаб/reduced motion, скрытые цели и cleanup. Публикация stable блокируется до такой evidence и человеческого review.

Доступный облачный браузер на 10.10.2026 принудительно перевёл HTTP-тестовый адрес в HTTPS и получил «remote server does not speak TLS» до страницы входа. Это не доказывает, что сервер недоступен в вашем браузере. Миры, установленные модули и серверные настройки не менялись.
