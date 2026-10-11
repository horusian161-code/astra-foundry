# Один устанавливаемый модуль Astra + REDLINE

Текущая поставка — **один Foundry-пакет** с прежним ID `astra-redline-combat`.
Переиспользуемые компоненты Astra SDK входят в его `scripts/sdk` и `scripts/ui-kit`;
REDLINE и адаптер CPR находятся в собственных каталогах того же пакета. Клиенту игрока
не требуется отдельно устанавливать Studio или библиотечный SDK ZIP.

## Состав поставки

`python3 tools/build.py` создаёт:

- `dist/astra-redline-combat-0.3.0-alpha.1.zip` — единственный устанавливаемый runtime;
- соответствующий `.sha256` — контрольная сумма ZIP;
- `dist/build-manifest.json` — версия, индекс файлов и отпечаток исходников поставки.

Имя ZIP всегда вычисляется из актуальных `module.json.id` и `module.json.version`.
Внутри ZIP находится каталог `astra-redline-combat/` с `scripts/`, `styles/`,
`templates/`, `module.json`, `LICENSE` и `README.md`. Инструменты сборки, тесты,
исследовательские документы, рендеры, `node_modules`, Git и прежний отдельный SDK
не попадают в runtime. Они остаются в отдельном исходном комплекте.

Сборка ничего не удаляет из старых исходников и `dist`. Прежний
`tools/build-sdk-library.py` сохранён как исторический эксперимент; текущие CI,
alpha и stable workflows его не вызывают и отдельный SDK ZIP не публикуют.

ZIP получает фиксированные время и права каждого файла. При тех же байтах исходников
и той же версии сборщик создаёт тот же ZIP SHA256. `sourceFingerprint` — SHA256
от упорядоченного индекса `runtime-relative-path + NUL + file-SHA256 + LF`.
Это отпечаток **исходников поставки**, а не подпись автора или Git commit.

## Alpha и stable — разные пути

Пользователь разрешил публиковать результат для самостоятельной установки и тестирования.
Для этого предусмотрен отдельный **ALPHA prerelease**. Он не означает готовность
боевой автоматизации или прохождение приёмки внутри Foundry.

| Путь | Что требуется | Что он означает |
|---|---|---|
| Локальная сборка / CI artifact | Локальные проверки и чистый runtime ZIP | Файлы собраны; установки и live-проверок это не доказывает |
| ALPHA prerelease | Явный ручной запуск, версия `x.y.z-alpha.N`, совпадающий существующий тег и commit, локальные проверки, точные URL и ZIP hash; `compatibility.verified` отсутствует | Разрешённая экспериментальная установка; live Foundry acceptance ещё не пройдена |
| Stable release | Всё выше для стабильной версии плюс привязанные live, visual, two-client и native-operation evidence, проверка пакета и отдельная человеческая приёмка | Выпуск только принятого стабильного кандидата |

Для alpha manifest должен иметь точный URL:
`https://github.com/horusian161-code/astra-foundry/releases/download/vVERSION/module.json`.
`releases/latest` не подходит для доставки этого prerelease. `download` ссылается
на единственный ZIP того же `vVERSION`. Имя репозитория — выбранное место публикации;
наличие workflow в исходниках само по себе не создаёт репозиторий, тег или release.

Workflows не создают и не перемещают теги. Alpha release явно получает `prerelease: true`
и предупреждение об отсутствии live-приёмки. Он не вызывает stable gate с ослабленными
условиями и не помечает себя стабильным. В релизе могут быть отдельные `module.json`,
checksum и build metadata, но устанавливаемый ZIP остаётся один.

## Stable release gate

Команда для **проверки**, а не публикации:

```bash
node tools/release-gate.mjs \
  --evidence docs/readiness.json \
  --review docs/release-review.json \
  --package dist/astra-redline-combat-VERSION.zip \
  --channel stable \
  --expected-version VERSION \
  --trusted-reviewer EXPECTED_REVIEWER
```

Выход 0 означает соответствие формата, привязок и обязательных файлов. Выход 1 означает
блокирующие условия, выход 2 — ошибку вызова. Текущая alpha заведомо получает блокировку
stable-пути. `docs/readiness.example.json` — незаполненный шаблон, не доказательство.

Gate самостоятельно пересчитывает отпечаток runtime, SHA256 ZIP и всех evidence-файлов.
Он проверяет CRC ZIP и требует точного совпадения его файлов с исходным индексом.
Версия manifest, ожидаемая версия команды, metadata сборки, все отчёты и review должны
указывать на **один конкретный пакет**. Изменение файла после проверки нарушает привязку.

Gate требует пять групп настоящих файлов отчётов:

| Группа | Обязательные проверки |
|---|---|
| `local-checks` | Unit tests, static checks, runtime build |
| `live-foundry` | Изолированный тестовый мир, запуск в v12, штатные документы как источник истины, права игрока/GM, повторное открытие, очистка при смене сцены |
| `visual` | Работающий модуль при 1920×1080 и 1366×768, русский длинный текст, пустое состояние, большая очередь, reduced motion, компактный/расширенный режим, скрытые цели |
| `two-client` | Два разных GM/player-клиента и пользователя, применение одного запроса один раз, переподключение и права |
| `native-operations` | Подготовка атаки, бросок, защита, применение урона, боеприпасы и следующий ход через проверенный системный адаптер |

Каждая проверка с `status: "passed"` обязана ссылаться на существующие вспомогательные
файлы с проверенными хэшами. Одни поля `ready: true`, `foundryTested: true` или
`testsPassed: true` не принимаются вместо отчётов. Live-отчёты идентифицируют одинаковый
изолированный мир, Foundry и CPR; рабочий мир не принимается как среда для мутационной
приёмки. Вместо личного blacklist gate требует `environment.worldPurpose: "isolated-test"`
и проверку `foundry.isolated-world` со ссылкой на хэшированный артефакт. Достоверность
изоляции проверяет reviewer; строка назначения среды сама по себе не доказывает её.
Native-отчёт указывает операцию адаптера, request ID,
квитанцию и документ. Визуальная приёмка требует PNG с реальными размерами и подписью
`running-foundry-module`; реконструкция или макет не заменяют её.

## Формат evidence

В `docs/readiness.json`:

```json
{
  "format": "astra-release-readiness-v1",
  "candidate": {
    "moduleId": "astra-redline-combat",
    "version": "VERSION",
    "sourceFingerprint": "ACTUAL_64_HEX_RUNTIME_FINGERPRINT",
    "packageSha256": "ACTUAL_64_HEX_ZIP_SHA256"
  },
  "entries": [
    {"kind": "live-foundry", "path": "evidence/live-foundry.json", "sha256": "ACTUAL_REPORT_SHA256"}
  ]
}
```

Один отчёт имеет `format: "astra-acceptance-evidence-v1"`, `kind`, такой же `candidate`,
`run: {id, startedAt, completedAt}`, `environment`, массив `checks` и массив `artifacts`.
Проверка имеет `{id, status: "passed", artifactPaths: [...]}`; файл имеет
`{path, sha256, mediaType}`. Точные обязательные ID экспортируются как
`REQUIRED_EVIDENCE` из `tools/release-gate.mjs`. Metadata ограничена по размеру, глубине,
числу записей и длинам полей. Пути не могут выходить из каталога кандидата.

`visual` дополнительно содержит `screens` с `checkId`, `width`, `height`, `artifactPath`
и `capture: "running-foundry-module"`. `two-client` содержит `clients` с разными `id`
и `userId` и ролями `gm`/`player`. `native-operations` содержит `operations` с `id`,
`adapterOperation`, `requestId`, `receiptId`, `documentUuids`.

`docs/release-review.json` имеет `format: "astra-release-review-v1"`, `reviewer`,
`decision: "approve-stable"`, `reviewedAt`, тот же `candidate` и `evidence` — точный
список `{kind, path, sha256}` из принятого readiness. Review выполняется после runs.
Ожидаемый reviewer берётся из независимой настройки stable release.

## Пределы gate и CI

Хэши обнаруживают подмену файлов, но не доказывают правдивость их содержимого. Gate
не является криптографической аттестацией, не устанавливает личность автора JSON и не
умеет по скриншоту удостоверить, что на нём Foundry. Он предотвращает случайную
публикацию неполного или другого кандидата. Обязательная независимая человеческая
приёмка stable остаётся отдельной проверкой достоверности материала.

`.github/workflows/release.yml` дополнительно требует защищённое окружение `production`,
ожидаемого человеческого reviewer, запрет самоодобрения и реальную историю approval
данного GitHub Actions run. Недостаточно просто назвать job `production` или вписать
имя reviewer в JSON. Такая конфигурация требует возможностей и настроек целевого
репозитория; её наличие и успешное выполнение на GitHub ещё должны быть проверены.
Отсутствие доступного approval API или требуемой защиты блокирует stable publication.

`.github/workflows/ci.yml` только проверяет и сохраняет artifact.
`.github/workflows/alpha-release.yml` — отдельный явно экспериментальный prerelease.
Все workflows требуют согласованный `package-lock.json` для `npm ci`.

Тест `tests/release-gate.test.mjs` создаёт временные **синтетические** отчёты, логи и
пустые PNG. Его complete fixture проходит проверки формата, файлов и хэшей; это не
свидетельство выполнения ни одного live-теста. Остальные тесты проверяют блокировки
при отсутствующих файлах, поддельном хэше, изменённом исходнике, неверном reviewer,
alpha promotion, неподходящих visual/two-client/native records и выходе пути из каталога.
