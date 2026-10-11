# Astra SDK: граница публичного вызова операций

Alpha 0.3 добавляет `OperationService` поверх существующего `OperationEngine`. Исходники оригинальные, лицензия MIT. Новый слой не выполняет аутентификацию, не создаёт socket transport, не выбирает GM и не записывает документы Foundry. Он связывает публичные команды с **уже доверенным** источником текущего principal.

## Использование

```js
import { OperationService, OperationEngine, MemoryStore }
  from '../scripts/sdk/index.mjs';

// Конфигурацию и descriptor передаёт разработчик доверенной интеграции.
const engine = new OperationEngine({
  store: new MemoryStore(),
  descriptors: [verifiedExampleDescriptor],
  executorId: 'local-demo-executor'
});

const operations = new OperationService({
  engine,
  // Не принимает пользовательский request, role или userId.
  // В реальной интеграции здесь должна находиться проверенная сессия.
  resolvePrincipal: async () => trustedSession.currentPrincipal()
});

await operations.prepare({
  operation: 'example.reserve',
  requestId: 'reserve-001',
  args: { amount: 2 }
});
await operations.execute({ requestId: 'reserve-001' });
const safeView = await operations.get({ requestId: 'reserve-001' });
operations.dispose();
```

Подмена `trustedSession` данными из формы или socket payload разрушает исходную предпосылку. Слой нельзя объявлять системой аутентификации или доказательством сетевой безопасности. В отдельном демо допустимо переключать условную личность; это остаётся симуляцией ролей.

## Контракт запросов

| Метод | Единственные допустимые поля | Результат |
|---|---|---|
| `catalog({})`, `catalog()` | Нет полей | Сериализуемое описание зарегистрированных операций |
| `prepare({requestId, operation, args})` | Все три обязательны | Проекция prepared/waiting/ready либо существующей записи |
| `decide({requestId, choice})` | Оба обязательны | Проекция принятого решения |
| `execute({requestId})` | Только обязательный requestId | Проекция исполнения/результата |
| `get({requestId})` | Только обязательный requestId | Текущая публичная проекция |
| `recover({requestId})` | Только обязательный requestId | Проекция восстановления без выдуманного исхода |
| `cancel({requestId})` | Только обязательный requestId | cancelled до исполнения; uncertain во время исполнения |
| `dispose()` | Не принимает операционный request | Освобождение локального исполнителя и закрытие service |

`requestId` и `operation` ограничены 1–128 ASCII символами идентификатора. Choice — непустая строка до 64 символов без control characters; допустимость самого выбора проверяется engine и descriptor. Args — конечный JSON по существующему canonical contract: без функций, accessors, циклов, sparse arrays, нестандартных объектов и бесконечных чисел, не более 64 KiB canonical JSON, глубина до 32, не более 8192 значений.

Любой лишний верхний ключ, включая `principal`, `role`, `userId`, `rights`, `executor`, `executorId`, `audience`, вызывает `invalid-input` **до** обращения к доверенному resolver. Верхние getters, symbol keys, наследуемые пользовательские envelopes и классы также отклоняются. Недопустимые данные не дают частичное действие.

Внутри `args` находятся только данные доменной операции. Они не становятся principal, role или executor. Возможность допустимого поля типа «роль персонажа» определяется validator конкретного descriptor; запрет всех совпадающих имён во всех будущих системах не вводится. Нельзя проектировать permission как доверие к `args.role` или `args.userId` вместо resolver identity.

## Идентичность и права

Для **каждого** допустимого публичного вызова, включая catalog, service заново вызывает `resolvePrincipal()` без аргументов. Результат должен быть plain JSON projection с непустым `id` не длиннее 128 символов; дополнительные доверенные поля доступны permission descriptor. Сохраняется отдельный JSON snapshot текущего вызова. Целый Foundry User Document передавать не нужно: интеграция должна вернуть требуемую проекцию пользователя.

Нет principal, сломанный callback или неподдерживаемая JSON projection → `rights`. Изменение сессии между вызовами учитывается автоматически. Никакие role/userId из команд не перекрывают callback.

Engine по-прежнему проверяет permission на prepare, preview, inspect, decide, execute, recover, reconcile, cancel и непосредственно перед commit/fence. Проверяется и присоединение второго principal к уже выполняющемуся запросу. Service не заменяет эти проверки и не делает ранее подготовленный request разрешением на будущую запись.

Снимок principal текущего вызова не является постоянно обновляемой сессией. Если права могут быть отозваны **во время** долгого выполнения, permission доверенного descriptor должен сверять их с текущим источником прав на стадии commit. Общее сетевое хранилище и проверка fencing token внутри доменного commit по-прежнему требуются для настоящего распределённого исполнения.

Catalog описывает фактические функции descriptor; наличие записи в catalog не предоставляет право их выполнять и не доказывает, что произвольные аргументы разрешены текущему пользователю.

## Публичные результаты и ошибки

Service вызывает исключительно participant методы engine и возвращает отдельную JSON copy их публичной проекции. Нет `getAuthorityRecord`, `retry`, `compensate`, `register`, `store`, `engine`, изменения executor, выбора audience или callback доступа на публичном объекте.

В проекции отсутствуют raw args, canonicalArgs, private preview/result, lease, executor ID и полная квитанция адаптера. Скрытые числовые итоги атаки не должны попадать в public descriptor; engine дополнительно удаляет известные ключи до решения защиты. Секреты всё равно хранятся только у доверенного исполнителя: service не превращает браузерное IndexedDB игрока в закрытое хранилище.

Ошибки сохраняют явный поддерживаемый код `OperationError`, но произвольный message, details и stack адаптера не пересылаются как результат операции. Код извлекается только из собственного data property: getter `code` не выполняется, а ошибка Proxy reflection также перехватывается. Непредусмотренное исключение получает `uncertain`; интерфейс должен объяснять код своим локализованным текстом. Это защищает от случайной передачи HP, скрытого броска или token через exception message.

## Очистка и границы

`dispose()` идемпотентно запрещает новые вызовы и вызывает `engine.dispose()` для локальных AbortSignal. Этот service является владельцем lifecycle переданного engine; несколько service над одним engine разделят последствия его dispose. Для общего gateway используйте один владеющий service либо организуйте владение жизненным циклом на уровне доверенной интеграции.

Если dispose произошёл во время await resolver, действие не начинается. Engine также использует lifecycle generation, чтобы ожидание permission до создания AbortController не могло начать исполнение после закрытия. Новая привязка может повторно использовать engine, но прежние вызовы остаются с недействительной generation. Та же проверка действует для поддерживаемой компенсации.

Если dispose произошёл после executing marker, но до входа в execute adapter, engine фиксирует `failed` с `provenNoMutation: true`. Если адаптер уже начал работу, он получает abort и обязан освободить свои ресурсы; запись может остаться `uncertain`. Если receipt успел сохраниться, запись остаётся `resolved`. Публичный вызов закрытого service возвращает `cancelled` независимо от этих состояний записи. Это различает закрытие интерфейса от игрового исхода и не обещает rollback. Произвольные внешние Promise, например зависший identity provider, по-прежнему требуют timeout/очистку со стороны доверенной интеграции.

Raw `OperationEngine` остаётся экспортированным для **доверенных разработчиков** и тестов. Он позволяет передавать principal напрямую и получать authority record после собственной проверки прав. Не выставляйте этот raw объект пользовательским формулам, agent tool endpoint или socket handler; отдавайте им только соответствующий `OperationService`.

## Проверено

`node --test tests/sdk-service.test.mjs`: 21 тест. Проверены spoof верхних role/userId/rights/executor, getters и дополнительные ключи, обновление current principal, duplicate request/payload collision, join чужого inflight, unknown operation, отсутствие executor, отсутствие private полей, нормализация исключений и неисправный error getter/Proxy, отмена, dispose до/во время resolver, до/после executing marker, до компенсации и cleanup активного адаптера. Совместно с 26 engine tests — 47/47 PASS. Это локальные проверки нейтрального SDK; никаких системных бросков, socket обработчиков, серверной аутентификации или операций мира Foundry тест не выполняет.
