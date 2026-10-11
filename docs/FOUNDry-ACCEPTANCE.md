# Проверка preparation alpha 0.2 в тестовом Foundry

Точный server build, system version и ID изолированного тестового мира прежде всего записать в протокол. Не использовать рабочий мир вместо отдельного тестового мира. В публичном протоколе не указывать личное название кампании; назначение среды — `worldPurpose: "isolated-test"`.

| Проверка | Ожидаемое поведение | Текущее доказательство |
|---|---|---|
| Штатный tracker рядом с REDLINE | Одинаковые Combat/Combatant, round, порядок и current/next | Mock + v12 docs; live нет |
| Изменить selected token при current другого участника | selected меняется; current и target сохраняются | Unit |
| Два linked и два unlinked tokens одного Actor | Отдельные Token identities; synthetic HP читаются своего токена | Unit |
| Player + GM, hidden Combatant и hidden Token | Player projection не включает hidden; GM видит | Unit; двухклиентной проверки нет |
| Невидимая/исчезнувшая цель, смена света/стен | Цель исчезает после visibility refresh | Pure filter + hooks по docs; live нет |
| Player чужой NPC | Имя/портрет видимого Token; без точных ресурсов и Actor UUID | Unit с бросающим private getter |
| Неизвестный path и пустой магазин | Unknown отображается —, magazine0 отображается0 | Unit |
| Actor-only/manual Combatant | GM видит строку, без Token control; player пока исключён | Unit + ограничение README |
| Родной лист и fallback tracker | Штатные окна открываются через публичный вызов | Только исходники; live нет |
| Закрыть через API или напрямую Application.close, reopen | Нет накопленных listeners/hooks/timers | Mock V1 unit; profiling live нет |
| 1920×1080, 1366×768; 100/115/130%, длинные имена | HUD не перекрывает chat/sidebar, доступно scroll и compact | DOM fixture доступна; live нет |
| Предпросмотр атаки/отключённое исполнение | DV с источником и ожидаемый расход; нет броска/изменения документов | Source guard + unit pure planner/port |
| Ручные profile/distance/modifier confirmations | Unknown блокируется; ready не включает execution | Unit; реальная форма не проверена |
| Смена Token/weapon/target, movement, Actor/Item change | Старые подтверждения дистанции/профиля/modifiers сбрасываются | Pure unit + source hook wiring; live нет |
| Stale weapon, несколько targets, непроверенная дистанция | Нет молчаливой замены оружия/цели, причины блокировки понятны | Unit |
| Native API: ложные owner/reflex, функции, accessors, неизвестные поля | Ошибка входа до вызова controller; hidden data не принимается | Unit |
| Preferences | scopeclient; нет world flags или настройки рабочего мира | Source check |
| Конфликт модулей | Alpha не меняет chat hooks, tracker class, Actor/Item methods | Source review; комбинация не проверена |

Первый следующий исполняющий slice только после native baseline: источник конкретного Item attack method → диалог системы → подтверждение → один native roll. До его проверки capabilities.nativeRoll остаётся false. Урон, патроны и nextTurn не подключать в обход системы.

Боевой HTML, SDK/Core и журнал/база проверены отдельно от этой таблицы. Node tests не подтверждают IndexedDB в браузере, UI 1920×1080/1366×768, два настоящих Foundry-клиента, server permissions, reconnect или атомарность игровых документов. Полный локальный результат alpha 0.2: 125/125, docs/validation-tests.txt. Для настоящего workflow обязательны live двойной click/двойной executor, cancel до расхода, commit→ack interruption, receipt reconciliation и отключённые анимации. Сейчас эти проверки не выполнялись.

Ссылки v12:

- https://foundryvtt.com/api/v12/classes/client.Application.html
- https://foundryvtt.com/api/v12/classes/client.Combat.html (`combatant`, `nextCombatant`, `turns`)
- https://foundryvtt.com/api/v12/classes/client.Combatant.html
- https://foundryvtt.com/api/v12/functions/hookEvents.sightRefresh.html
- https://foundryvtt.com/api/v12/functions/hookEvents.visibilityRefresh.html
- https://foundryvtt.com/api/v12/functions/hookEvents.refreshObject.html (`refreshToken`)

Наблюдённые CPR paths по исходникам source consumer, без переноса кода:
https://github.com/Vec97/cpr-combat-hud/blob/v1.1.3/scripts/hud.js
