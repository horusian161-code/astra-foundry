# Подготовка атаки CPR — alpha 0.2

`prepareAttack(input)` в `scripts/adapters/cpr-attack-plan.mjs` — чистый адаптер предпросмотра. Он получает ограниченные обычные данные, не обращается к `game`, Canvas, Actor/Item, сокетам, броскам или хранилищу. Возвращает новые данные и не расходует патроны.

Начальный срез — **один обычный одиночный выстрел** из пистолета или штурмовой винтовки. Результат `ready` означает достаточность данных для подготовки, а не возможность выполнить реальную атаку. Во всех результатах `nativeRoll`, `ammoChange`, `damageApply`, `distributedExecution` и `defense.executionAllowed` равны `false`.

## Вход и выход

```js
const plan = prepareAttack({
  attacker: {id:'Scene.lab.Token.choom', owner:true, visible:true},
  weapon: {
    id:'Item.rifle', kind:'assaultRifle', ranged:true, rof:1, profileVerified:true,
    magazine:{value:30, max:30}
  },
  target: {
    id:'Scene.lab.Token.guard', visible:true, cover:'clear',
    defense:{reflex:8, aware:true, canDodge:true, exception:'none', dataAuthorized:true}
  },
  distance:{value:26, unit:'m', source:'manual', measurementVerified:true},
  mode:'single', modifiers:[], modifiersComplete:true
});
// status: ready; range DV: 13; expected ammo cost: 1; consumeNow: false
// defense: eligible; choices [range, evade]; opposedDV: null; no roll executed
```

| Поле | Контракт |
|---|---|
| `attacker.owner` | Снимок права OWNER или GM, вычисленный интеграционным портом, а не игроком в форме. Чистый preview не является границей авторизации реальных операций. |
| `weapon.kind` | Только `pistol` / `assaultRifle`. Тип оружия сам по себе не подтверждает отсутствие exotic, upgrades и особого расхода. |
| `weapon.profileVerified` | Обязательное `true`: подтверждён обычный одиночный выстрел с расходом одного патрона. Native UI требует явного подтверждения профиля; demo использует известную фикстуру. Неизвестный профиль блокирует подготовку и даёт `costs.ammo=null`, а не выдуманный расход. |
| `weapon.magazine` | Числа, а не строки. `value=0` — пустой магазин; `null` — неизвестное значение. `value > max`, отрицательные и дробные патроны блокируются. |
| `target.visible` | Уже проверенная доступность цели в представлении пользователя. Скрытая цель блокируется и не возвращает свой ID или данные защиты. |
| `target.cover` | `clear`, `blocked`, `unknown`. Это подтверждённое человеком состояние, а не вывод из цвета токена или геометрии Foundry. |
| `target.defense.dataAuthorized` | Только подтверждённый интеграционным портом доступ OWNER/GM к данным защищающегося. При отсутствии допуска точные значения игнорируются. Нельзя дать игроку переключатель этого флага. |
| `distance` | Подтверждённое целое неотрицательное расстояние `m` или `yd`; источник `manual`, `native` или `demo` показывается отдельно. Нативное измерение ещё не сертифицировано. |
| `modifiers` | До 32 записей: `id`, `label`, `value` (целое −99…99 или `null`), `checked`, `source`, необязательный `enabled`. Повторяющиеся ID блокируются. Неподтверждённая применяемая запись не считается нулём. |
| `modifiersComplete` | Подтверждение просмотра списка. Это не подтверждение точной системной формулы: `formulaCertified=false`. |

Выход содержит `status`, массив блокирующих `reasons` с кодом/полем/объяснением, дистанцию с источником, `dv` с таблицей и диапазоном, поддержанные/неподдержанные режимы, ожидаемые затраты, состояние защиты и аудит модификаторов. Сумма — только явно проверенные записи. Она **не изображает** полный REF + Skill + роль + quality + wound + эффекты без системного адаптера.

## Проверенные правила и принятые границы

| Правило | Решение в alpha | Первичный источник и уровень проверки |
|---|---|---|
| DV по дальности | Отдельные таблицы обычного ranged combat для pistol и AR. AR на 26–50 м/ярдах — DV 13. Не применяется таблица Autofire. | [Официально лицензированный текст Easy Mode на Roll20, Ranged Combat DVs Table](https://roll20.net/compendium/cpunk/Playing%20the%20Game). Текст таблицы прочитан 08.10.2026; полный corebook и рабочая система здесь не проверены. |
| Укрытие | Полная преграда блокирует прямую атаку по персонажу; атака объекта укрытия — отдельная операция. Значение `partial` не создаёт Cover +2, а требует уточнения. | Там же, Taking Cover. |
| Попадание | Метаданные сравнения `attack > DV`: ничья защищает. Preview не рассчитывает попадание. | [RTG Edgerunner Folio, страница 11](https://rtalsoriangames.com/wp-content/uploads/2024/07/RTG-CPR-DLC-Edgerunner-Folio-Form-Fillable.pdf), Skill Checks; Easy Mode Ranged Combat. |
| Уклонение от пуль | Обычная возможность при REF 8, восприятии атаки и отсутствии запрета. Дополнительные cyberware, DLC, injuries и домашние исключения не вычисляются автоматически. | [RTG FAQ v1.3, страницы 3–4](https://rtalsoriangames.com/wp-content/uploads/2021/07/RTG-CPR-CoreBookFAQv1.3.pdf): восприятие атаки и REF 8. |
| Порядок защиты | Выбор и бросок Evasion предшествуют Attack Check. Число противостоящего DV ещё неизвестно, пока бросок защиты не выполнен. | RTG FAQ v1.3, страница 4. |
| Прицельная атака | Метаданные: −8, ROF 1, зоны head/heldItem/leg. Режим показан как неподдержанный: последствия зон и исполнение не подключены. Нет Aim +1. | RTG Edgerunner Folio, страница 11. |
| ROF | Один preview — один выстрел, не расход всего ROF. `weaponROF` сохраняется отдельно; оставшиеся атаки и ход не считаются. Никаких bonus actions, универсального пула реакций или кулдаунов. | RTG Edgerunner Folio, страница 11; Easy Mode Splitting Your Movement and Attacks. |
| Патрон | Только после `profileVerified=true` ожидаемый расход обычного single bullet profile — 1, `consumeNow=false`. Сигнатура расхода точной версии CPR не сертифицирована; special/exotic расход требует расширения профиля. | [Официальный исходник CPR v0.89.2, `cpr-loadable.js`, метод `bulletConsumption`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/mixins/cpr-loadable.js): одиночный выстрел — один патрон. Код изучен, метод не вызывался. |
| Модификаторы | Нет скрытого автоматического Cover +2, Aim +1 или range +2. Wound/quality/roles/active effects должны поступать как проверенные записи из системы либо явное решение GM. | RTG Folio, страницы 2 и 11; FAQ v1.3, таблица влияния на проверки, страница 2. |
| Дробная дистанция | Блокируется до подтверждения округления/интервалов точной системы. Нельзя молча применять ceil или переносить непрерывные интервалы из старого демо. | Инженерная граница; не правило CPR. |

Сами диапазоны и числа DV закодированы как факты правил, а не перенесённый исходный код стороннего модуля. Код адаптера написан отдельно. Тексты и изображения книг не включены в устанавливаемый пакет.

## Неизвестная защита и скрытая информация

Для игрока чужой REF, cyberware, injuries и точные ресурсы обычно отсутствуют в публичном read model. Это не мешает подготовить выстрел по видимой цели: таблица диапазона показывается как **условный ориентир** (`dv.conditional=true`). При этом `defense.eligibility='unknown'`, `needsGM=true`, `options=[]`, `opposedDV=null`. Отсутствие данных не превращается в попадание или отказ от защиты; исполнение должно остановиться на ручном решении GM.

При доступных подтверждённых данных:

- REF меньше 8 и `exception='none'` → обычная bullet Evasion недоступна; ориентир — range DV.
- REF не меньше 8, `aware=true`, `canDodge=true`, `exception='none'` → варианты `range` / `evade`; выбор и Evasion до атакующего броска.
- Подтверждённые `aware=false` или `canDodge=false` → обычная Evasion недоступна.
- Неизвестный или включённый special exception → проверка GM; никаких выдуманных правил cyberware.

Числа REF, характеристики, содержимое Actor и оружие цели в ответ не возвращаются. Эту фильтрацию всё равно необходимо делать **до передачи через сеть**, а не считать `dataAuthorized` защитой уже переданного payload. Alpha не создаёт сетевых запросов защиты.

## Foundry v12 и точная система

[Foundry v12 `foundry.grid.BaseGrid.measurePath`](https://foundryvtt.com/api/v12/classes/foundry.grid.BaseGrid.html#measurePath) описывает измерение прямого пути; [`GridMeasurePathResult.distance`](https://foundryvtt.com/api/v12/interfaces/foundry.GridMeasurePathResult.html) — полученную дистанцию. Сетка также хранит `units` и `distance`. Это подтверждение API v12, а не подтверждение соответствия линейки всем правилам CPR: нужно проверить точки измерения токенов, диагонали/hex/gridless, высоту, единицы и дробные границы в установленной системе.

Официальный проект: [FVTT Cyberpunk RED Core, Project RED GitLab](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core). Основной инструмент чтения вернул ошибку raw/tag; альтернативное получение первичного текста через Exa успешно прочитало следующие файлы **тега `v0.89.2`** 08.10.2026:

- [`cpr-attackable.js`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/mixins/cpr-attackable.js): `_createAttackRoll(type, actor)` собирает системные модификаторы; `dischargeItem` изменяет магазин. Наличие внутреннего метода не означает стабильный публичный API. В alpha они не вызываются.
- [`cpr-loadable.js`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/mixins/cpr-loadable.js): `bulletConsumption` — обычный выстрел 1, Autofire/Suppressive 10; `hasAmmo` проверяет достаточность магазина. `getMagazineSpace` учитывает upgrades, поэтому `magazine.max` не всегда эффективная ёмкость. Данные preview требуют подтверждённой эффективной границы; значение выше базового max нельзя автоматически объявить сломанным Actor.
- [`cpr-rolls.js`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/rolls/cpr-rolls.js): просмотрена структура роллов и расчёта модификаторов; `roll()` выполняет бросок отдельно.

Это чтение текста по URL тега, **не проверка опубликованного ZIP или байтов installed release**. Поля и вызовы конкретной версии на сервере ещё требуют проверки. Предыдущий snapshot `davidkan1996` — fork, не доказательство официального `v0.89.2`. Исходный код fork/GPL не скопирован в адаптер. Системные роли, эффекты, upgrades, wound/armor penalties не заменяются произвольной суммой из формы.

## Локальная проверка

Команда: `node --test tests/attack-plan.test.mjs`. Результат: **21/21**, 08.10.2026.

Покрыты все границы двух таблиц, AR 26 м, неподдержанные дальности, дробные/неподтверждённые измерения, нулевой/неизвестный/некорректный магазин, отсутствие оружия, ROF, неизвестный профиль/расход, режимы, отсутствие OWNER, скрытая цель, полное/неизвестное укрытие, REF 8, неизвестная/неавторизованная защита, восприятие/запреты, исключения, модификаторы, повторяющиеся ID, неизменность входа и отказ от accessors/документов/функций/неограниченных данных.

Изучено по источникам → implemented pure preview → проверено локальными тестами. **В Foundry не проверено.** Реальные броски, расход, урон, бюджет хода, Aim/Autofire/Suppressive, защита по сети и особые weapons не реализованы этим адаптером.
