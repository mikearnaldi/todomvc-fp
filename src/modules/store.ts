import {
  effect as T,
  ref,
  stream as S,
  queue as Q,
  managed as M,
} from "@matechs/effect";
import { subject } from "@matechs/effect/lib/stream";
import { pipe } from "fp-ts/lib/pipeable";
import * as O from "fp-ts/lib/Option";

export interface Store<A> {
  next: (f: (current: A) => A) => T.Effect<unknown, unknown, never, void>;
  interrupt: T.Effect<unknown, unknown, never, void>;
  subscribe: T.Sync<S.Stream<unknown, unknown, never, A>>;
}

export const store = <A>(initial?: A) =>
  pipe(
    Q.unboundedQueue<A>(),
    T.zip(ref.makeRef(initial ? [initial] : [])),
    T.chain(([queue, state]) => {
      const next = (f: (current: A) => A) =>
        pipe(
          state.update(([current]) => [f(current)]),
          T.chain(([a]) => queue.offer(a))
        );

      return pipe(
        subject(S.fromSource(M.pure(pipe(queue.take, T.map(O.some))))),        
        T.map((s): Store<A> => ({ ...s, next }))
      );
    })
  );
