import { effect as T, stream as S } from "@matechs/effect";

import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/Array";
import { pipe } from "fp-ts/lib/pipeable";
import { constant, identity, flow, constVoid, tuple } from "fp-ts/lib/function";

import * as t from "io-ts";
import { Do } from "fp-ts-contrib/lib/Do";

import {
  createElement,
  querySelector,
  makeElementNotFound,
  $,
  parentElement,
  makeParentElementNotFound,
} from "./dom";
import * as Fetch from "./fetch";
import { subscribe } from "./emitter";
import { store, Store } from "./store";
import { completed } from "@matechs/effect/lib/effect";

/**
 * ```hs
 *
 * URL :: string
 *
 * ```
 *
 * API URL where a list of todo objects is requested from
 */
const URL = "https://jsonplaceholder.typicode.com/todos";

/**
 * ```hs
 *
 * Todo :: t.TypeC<Todo>
 *
 * ```
 *
 * io-ts decoder for Todo
 */
const todoDecoder = t.type(
  {
    id: t.number,
    userId: t.number,
    title: t.string,
    completed: t.boolean,
  },
  "Todo"
);

/**
 * ```hs
 *
 * Todos :: t.TypeC<Todos>
 *
 * ```
 *
 * io-ts decoder for a list of [[Todo]]
 */
const todosDecoder = t.array(todoDecoder);

// Types
export type Todo = t.TypeOf<typeof todoDecoder>;

export type Todos = t.TypeOf<typeof todosDecoder>;

// APIS
export const fetchTodos = pipe(
  // Fetch list of todos from the server
  Fetch.fetch(URL),
  // Decode the response
  T.chain((response) => T.sync(() => todosDecoder.decode(response))),
  // From Effect<R, E, Either<E2, Todos> to Effect<R, E | E2, Todos>
  T.chain(T.fromEither)
);

/**
 * ```hs
 *
 * html :: string
 *
 * ```
 *
 * HTML used to create a todo for
 */
const html = `<li>
    <div class="view">
        <input data-toggle class="toggle" type="checkbox">
        <label data-edit>Buy a unicorn</label>
        <button data-remove class="destroy"></button>
    </div>
    <input class="edit" value="Rule the web">
</li>`;

// TODO: Use environment to produce div
const _div = createElement("div");

/**
 * ```hs
 *
 * todosStore :: Effect unknown never (Store Todos)
 *
 * ```
 *
 * You can update the list of todos by passing a callback function to store.next
 * or subscribe to store changes using the store.subscribe stream.
 */
export const todosStore = store<Todos>();

/**
 * ```hs
 *
 * createTodoLi :: Effect Dom ElementNotFound HTMLLIElement
 *
 * ```
 *
 * Create a dom element for a todo
 */
export const createTodoLi = pipe(
  _div,
  T.chain((el) =>
    T.sync(() => {
      el.innerHTML = html;
      return querySelector("li")(el);
    })
  ),
  T.chain(
    T.fromOption(
      constant(
        makeElementNotFound("Unable to create DOM element for todo item.")
      )
    )
  )
);

/**
 * ```hs
 *
 * todosUl :: Effect DocumentEnv ElementNotFound HTMLUListElement
 *
 * ```
 *
 * Select the ul dom node that contains the list of li nodes that are todo items.
 */
export const todosUl = $<HTMLUListElement>(".todo-list");

export const clearTodosUl = pipe(
  todosUl,
  T.chain((ul) =>
    T.sync(() => {
      ul.innerHTML = "";
    })
  )
);

/**
 * ```hs
 *
 * updateTodoLi :: Todo -> HTMLLIElement -> Effect unknown Error HTMLLIElement
 *
 * ```
 *
 * Update a given todo dom li node with information from a [[Todo]] model
 */
export const updateTodoLi = (todo: Todo) => (todoLi: HTMLLIElement) =>
  pipe(
    Do(O.option)
      // Select the input and label dom nodes that are inside the li node
      .bind("label", querySelector("label")(todoLi))
      .bind("checkbox", querySelector("input")(todoLi))
      .bind("input", querySelector<HTMLInputElement>("input.edit")(todoLi))
      .return(({ label, checkbox, input }) =>
        T.sync(() => {
          // Update title
          label.innerHTML = todo.title;

          // Add todo id as attribute
          todoLi.setAttribute("data-todo-id", "" + todo.id);

          // Mark as completed if so
          todo.completed && todoLi.classList.add("completed");
          checkbox.checked = todo.completed;
          input.value = todo.title

          return todoLi;
        })
      ),
    // TODO: Handle if label or input aren't available
    T.fromOption(constant(Error(""))),
    T.chain(identity)
  );

/**
 * ```hs
 *
 * renderTodos :: [Todo] -> Effect (DocumentEnv & Dom) (Error | ElementNotFound) (void, HTMLUListElement)
 *
 * ```
 *
 * Clear the ul dom node and re-render the list of li todo items.
 *
 */
export const renderTodos = (todos: Todos) =>
  T.zip(
    pipe(
      todos,
      A.map((todo) => pipe(createTodoLi, T.chain(updateTodoLi(todo)))),
      A.array.sequence(T.effect),
      T.chain((list) =>
        pipe(
          $<HTMLUListElement>(".todo-list"),
          T.chain((ul) =>
            T.sync(() => {
              list.forEach((li) => ul.appendChild(li));
              return ul;
            })
          )
        )
      )
    )
  )(clearTodosUl);


const clickStream = (store: Store<Todos>) => pipe(
  // With the dom node that is the lisf items
  todosUl,
  S.encaseEffect,
  // Subscribe to clicking the list
  S.chain(
    pipe(
      subscribe("click"), 
    )
  ),
  // Map the mouse event to the target (currentTarget would be the list, we want what the user actually clicked.)
  S.map((_) => _.target),
  S.map(O.fromNullable),
  S.chain(S.fromOption),
  S.chain((_) => {
    const target = _ as HTMLElement;

    const todoIdT = pipe(
      parentElement<HTMLElement, HTMLDivElement>(target),
      O.chain((div) =>
        parentElement<HTMLDivElement, HTMLLIElement>(div)
      ),
      T.pure,
      T.chain(
        T.fromOption(constant(makeParentElementNotFound(target)))
      ),
      T.map((parent) => pipe(
        parent.getAttribute("data-todo-id"),
        O.fromNullable,
        O.map(Number),
        O.map(todoId => tuple(todoId, parent))
      )),
      T.chain(
        T.fromOption(constant(makeParentElementNotFound(target)))
      ),
    );

    // If the clicked the remove button
    if (target.hasAttribute("data-remove")) {
      return pipe(
        todoIdT,
        T.chain(([todoId]) =>
          store.next((todos) =>
            todos.filter((todo) => todo.id !== todoId)
          )
        ),
        S.encaseEffect
      );
    } else if (target.hasAttribute("data-toggle")) {
      return pipe(
        todoIdT,
        T.chain(([todoId]) =>
          store.next((todos) =>
            todos.map((todo) => todo.id === todoId ? {...todo, completed: !todo.completed} : todo)
          )
        ),
        S.encaseEffect
      );
    } else if (target.hasAttribute("data-edit")) {
      return pipe(
        todoIdT,
        T.chain(([todoId, li]) => {
          const addClass = T.sync(() => {
            li.classList.add('editing')
          });

          const removeClass = T.sync(() => {
            li.classList.remove('editing')
          })

          const input = pipe(
            li,
            querySelector<HTMLInputElement>('input.edit'),
            T.fromOption(constant(makeElementNotFound('li>input'))),
            T.chain(input => {
              const focus = T.sync(() => { 
                input.focus();
                input.select()
               })

               const blur = pipe(
                 input,
                 subscribe('blur'),
                 S.take(1),
                 S.drain,
                 T.zip(removeClass)
               )

               const save = pipe(
                 input,
                 subscribe('keyup'),
                 S.filter(event => event.key === 'Enter' && !!input.value.trim()),
                 S.take(1),
                 S.drain,
                 T.chain(constant(
                  store.next((todos) =>
                    todos.map((todo) => todo.id === todoId ? {...todo, title: input.value } : todo)
                  )
                 )),
                 T.zip(removeClass)
               )

               return pipe(
                 focus,
                 T.zip(T.race(blur, save))
               )
            })
          )

          return pipe(
            addClass,
            T.zip(input),
          )
        }
  
        ),
        S.encaseEffect
      );
    }

    return S.encaseEffect(T.pure(constVoid()));
  }),
  S.drain
)

const loadTodos = (store: Store<Todos>) => pipe(
  // Fetch todos from the sever
  fetchTodos,
  // Put items in the store
  T.chain(flow(constant, store.next)),
  // Fork fetching todos
  T.fork,
  T.chain(
    constant(
      pipe(
        // Subscribe to the store
        store.subscribe,
        T.chain((stream) =>
          pipe(
            stream,
            // Only take 10 items at a time
            S.map((list) => pipe(list, A.takeLeft(10))),
            // Update the DOM
            S.chain(flow(renderTodos, S.encaseEffect)),
            S.drain
          )
        )
      )
    )
  )
)

/**
 * The main event
 */
export const main = pipe(
  pipe(
    // Use the store
    todosStore,
    T.chain((store) =>
      T.parZip(
        // Fetch todos and subscribe to the store for updates and re-render
       loadTodos(store),
       clickStream(store)
      )
    )
  )
);
