# NativeActionPort — alpha 0.3

**Готов порт проверки доступа и окружения, но реальные операции атаки, перезарядки и урона выключены.** Исследование обнаружило штатные внутренние пути CPR и экспортированный макрос. Для надёжного workflow этого недостаточно: результат макроса не различает отмену и успех, предмет выбирается по имени, часть изменений не ожидается, отсутствует receipt. В `game.cpr.api` двух изученных тегов боевой API не опубликован.

Файлы: `scripts/adapters/native-action-port.mjs`, `tests/native-action-port.test.mjs`.

## Проверенные первичные источники

Ниже — **исходные тексты официальных тегов**, не рабочий мир и не опубликованный ZIP. Тег `v0.89.2` изучен отдельно; сопоставление `v0.92.4` не объявляет его установленной версией.

| Штатная точка | Сигнатура / поведение | Возможность внешнего вызова |
|---|---|---|
| `game.cpr.api.actor.getEMPableItems` | `(actorData)` возвращает список EMP-уязвимых items. Initializer API подключает только этот модуль. | Отдельный API; не атака, не reload, не damage. |
| `game.cpr.macro.rollItemMacro` | `async (itemName, extraRollArgs={skipPrompt:false,rollType:'attack'})`. Получает Actor через `ChatMessage.getSpeaker()`, берёт первый Item с совпавшим именем. | Экспортированный макросный путь; отсутствуют Token/Item UUID, request ID и структурированное завершение. Порт не вызывает его. |
| `item.createRoll` | `(type, actor, extraData=[]) → CPRRoll или null`. Диспетчер создаёт roll и системные modifiers через внутренние методы. | Кандидат изучения, а не подтверждённый стабильный API модуля. |
| `roll.handleRollDialog` | `async (event, actor, item) → boolean`. Отмена возвращает `false`; подтверждение/пропуск — `true`. Изменяет объект roll. | Часть системного pipeline. Без полного bridge нельзя запускать отдельно. |
| `item.confirmRoll` | `(cprRoll) → CPRRoll`. Для ranged attack вызывает расход магазина; внутреннее изменение не awaited. | **Имеет игровые побочные эффекты.** Await на confirmRoll не доказывает завершение записи патронов. |
| `item.reload` | `async ()`. Если нет ammo, открывает load dialog; иначе отдельно записывает магазин и уменьшает ammo item. | Нет транзакции, request ID, единообразного receipt. Порт не вызывает. |
| `actor._applyDamage` | `async (damage,bonusDamage,location,ablation,ammoVariety,ignoreArmorPercent,ignoreBelowSP,damageLethal,formData)`. | Внутренняя точка. Меняет HP/щит/броню, создаёт карточку; порт не вызывает. |
| `CPRChat.damageApplication` | `static async (event)`: извлекает значения из HTML-карточки, открывает выбор и вызывает внутреннюю обработку. | Обработчик UI, не API приёма проверенного результата workflow. Порт не имитирует DOM event. |

Тексты тега `v0.89.2` прочитаны через первичный GitLab RAW:

- [API initializer](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/api/initialize.js)
- [Экспорт game.cpr](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/cpr.js)
- [Макрос](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/utils/cpr-macros.js)
- [CPRItem](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/cpr-item.js)
- [Attackable](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/mixins/cpr-attackable.js)
- [Loadable](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/item/mixins/cpr-loadable.js)
- [Rolls](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/rolls/cpr-rolls.js)
- [Actor](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/actor/cpr-actor.js)
- [Actor Sheet](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/actor/sheet/cpr-actor-sheet.js)
- [Chat](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.89.2/src/modules/chat/cpr-chat.js)

Тот же набор первичных файлов **отдельно** изучен для `v0.92.4`: [API](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/api/initialize.js), [macro](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/utils/cpr-macros.js), [Item](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/item/cpr-item.js), [Loadable](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/item/mixins/cpr-loadable.js), [Actor](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/actor/cpr-actor.js), [Sheet](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/actor/sheet/cpr-actor-sheet.js), [Chat](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/chat/cpr-chat.js), [Rolls](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/v0.92.4/src/modules/rolls/cpr-rolls.js).

Методы и выводы выше совпадают в изученных фрагментах двух тегов. Исходный `system.json` с `DUMMY_VALUE` не является manifest релизного ZIP. Код GPL не скопирован; здесь приведены имена контрактов и объяснение ограничений.

## Почему порт не склеивает вызовы самостоятельно

Штатный путь атаки: создание roll → dialog → confirmRoll с расходом → roll → chat. Отмена до confirmRoll прекращает атаки, но макрос может до диалога поменять firetype flags и затем восстановить их асинхронно. После confirmRoll отмена собственного интерфейса уже не означает отсутствие игровых изменений.

В макросе `undefined` соответствует и отмене, и завершению. `RenderRollCard` не awaited. В документном confirmRoll `dischargeItem` не awaited. Поэтому нельзя считать resolved Promise доказательством «бросок опубликован и магазин изменён ровно один раз».

Sheet и macro не эквивалентны: `_onRoll` содержит расход LUCK после броска, которого нет в прочитанном macro path. Для внешней интеграции также нужно отдельно проверять OWNER, текущий synthetic Actor токена и выбранный Item — эти шаги нельзя заменить самим фактом существования метода.

Перезарядка включает два документа. Ошибка между изменением магазина и ammo item требует проверки состояния. Повторный вызов автоматически не допускается. Для damage нельзя посылать обычный `actor.update(HP)`: системная обработка учитывает броню, щит, ammo, роли и эффекты, а её внутренний entrypoint пока не имеет надёжного внешнего результата.

## API оригинального порта

```js
const port = new NativeActionPort({
  resolveCurrentSelection: async () => ({
    token: currentNativePlaceable, // только текущий выбранный токен
    user: currentNativeUser,
    sceneId: currentNativeSceneId
  }),
  getRuntimeProfile: async () => ({
    profileId: 'cpr-v0.89.2-study',
    systemId: 'cyberpunk-red-core',
    systemVersion: 'v0.89.2',
    foundryGeneration: 12,
    foundryBuild: '343',
    worldId: currentWorldId,
    userId: currentNativeUser.id
  })
});

await port.prepare({
  operation:'weapon.attack', tokenUuid:'Scene.lab.Token.choom',
  weaponId:'ownedWeaponId', mode:'single'
});
// {status:'blocked', reason:{code:'unsupported-native-api', ...},
//  runtime:{executable:false, liveAccepted:false, ...},
//  capabilities:{nativeRoll:false, reload:false, damageApply:false, ...},
//  fallback:{id:'actor-sheet', available:true, automatic:false}, ...}

await port.execute({operation:'weapon.reload',weaponId:'ownedWeaponId'});
// Повторно проверяет текущий token/OWNER/item/profile; игровое исполнение отключено.

await port.openFallback({operation:'weapon.attack',weaponId:'ownedWeaponId'});
// Явно запрашивает родной Actor.sheet.render(true), status:'requested'.
// Не обещает результат броска или отсутствие побочных эффектов чужих render hooks.
```

Поддержанные имена операций — `weapon.attack`, `weapon.reload`, `damage.apply`. Для attack/reload обязателен `weaponId`; для damage этот ID запрещён. Допускается только `single` attack mode. Raw Actor/Item, Actor UUID, damage amount, permission assertion, runtime profile, `verified:true`, callback, class instance и дополнительные поля в аргументах отклоняются **до вызова провайдеров**.

Предмет берётся только из `currentToken.actor.items.get(weaponId)` и должен иметь `parent===actor` и `type==='weapon'`. Мировой Item или кибероружие нельзя незаметно подставить в этот начальный срез. Synthetic Actor разрешается естественным образом через actor текущего токена; мировая Actor-коллекция не используется.

Профиль получает доверенный модульный провайдер. Точная версия должна совпадать с записью исходников — semver диапазон не включён. Мир, build Foundry, текущий пользователь и generation обязательны. Переданные провайдером `liveAccepted:true`/`executable:true` не меняют выключенные capabilities: исполняемого профиля **в коде нет**.

Во всех blocked результатах `provenNoGameMutation=true` относится к порту, который не диспетчеризовал игровые действия. Родной лист открывается только отдельным явным `openFallback`; после внешнего `sheet.render` это утверждение не выдаётся. Сама альфа не получает заверений о побочных эффектах сторонних render hooks.

## Что потребуется для включения настоящего native bridge

1. Проверить точный установленный manifest и байты выпуска; закрепить версию, build и конфигурацию системы.
2. Выбрать реальный системный entrypoint. Для внутреннего пути — отдельный обоснованный opt-in и явный контракт; для public API — первичная документация сигнатуры.
3. Проверить LAB: linked/unlinked токены, повторяющиеся названия оружия, Cancel, LUCK, магазин/ammo, ошибки между записями, две вкладки/клиента и право OWNER.
4. Задать единственного исполнителя и поведение uncertain: никаких автоматических retry после возможного расхода; ручная проверка GM.
5. Реальный результат должен иметь подтверждение выполненных поддержанных операций. Анимации и скрытие DOM не служат подтверждением исполнения или защиты информации.
6. Добавить конкретный проверенный профиль **в код**, а не переключатель `verified` в публичном API. Отдельно применить allowlist ID тестового мира и фактически проверенную процедуру восстановления.

Сейчас эти условия не выполнены. Ни один путь real attack/reload/damage не включён и никакое исследование исходников не названо live acceptance.

## Проверка

`node --test tests/native-action-port.test.mjs` — **18/18**, 10.10.2026. Проверены отсутствие исполнения при наличии native methods, immutable study profiles, запрет permission/runtime assertions, ограничение входа, accessors, режимы, current token/scene/visibility, OWNER и GM, embedded Item ownership, точные runtime версии/пользователь, ошибки провайдеров, ожидание профиля и смена токена, повторная проверка прав, явный sheet fallback и отсутствие Document/private system payload в ответах.

Уровни: исходники изучены → fail-closed scaffold реализован → локальные тесты пройдены → внутри Foundry не проверено → нативные игровые операции ещё не включены.
