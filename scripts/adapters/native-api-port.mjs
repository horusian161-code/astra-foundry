import {OPERATION_CATALOG} from '../core/contracts.mjs';
import {canonicalPayload} from '../sdk/canonical.mjs';
import {OperationError} from '../sdk/errors.mjs';

/** Read/preview/UI calls only. Principal always comes from the controller's native projection. */
export async function invokeNativeOperation(controller,id,args={}) {
  const descriptor=OPERATION_CATALOG.find(entry=>entry.id===id);
  if(!descriptor)throw new OperationError('unsupported','Операция не зарегистрирована в native alpha.');
  const normalized=JSON.parse(canonicalPayload(args));
  if(!normalized||typeof normalized!=='object'||Array.isArray(normalized))throw new OperationError('invalid-input','Аргументы должны быть обычным объектом.');
  const properties=descriptor.args.properties??{};
  for(const [key,value] of Object.entries(normalized)) {
    const schema=properties[key];
    if(!schema)throw new OperationError('invalid-input',`Неподдержанный аргумент: ${key}`);
    const types=Array.isArray(schema.type)?schema.type:schema.type?[schema.type]:[];
    if(types.length&&!types.includes(typeof value))throw new OperationError('invalid-input',`Неверный тип аргумента: ${key}`);
    if(typeof value==='string'&&value.length>(schema.maxLength??256))throw new OperationError('invalid-input','Аргумент слишком длинный.');
    if(schema.enum&&!schema.enum.includes(value))throw new OperationError('invalid-input',`Неподдержанное значение: ${key}`);
  }
  switch(id) {
    case 'read.snapshot':return controller.snapshot();
    case 'read.queue':return controller.snapshot().queue;
    case 'read.selection':return controller.snapshot().selected;
    case 'read.targets':return controller.snapshot().targets;
    case 'attack.preview':return controller.attackPreview(normalized);
    case 'ui.open':return controller.open();
    case 'ui.close':return controller.close();
    case 'ui.toggle':return controller.toggle();
    default:throw new OperationError('unsupported','Исполнение операции отсутствует.');
  }
}
