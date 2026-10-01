// Resolves once an element is attached. Fed by a React callback ref, which
// runs on commit, so awaiting it orders work after the element is in the DOM
// without relying on how quickly React re-renders.
export function createElementGate<T>() {
  let element: T | null = null;
  let waiters: Array<(element: T) => void> = [];

  return {
    set(next: T | null) {
      element = next;
      if (next === null) return;
      const ready = waiters;
      waiters = [];
      ready.forEach((resolve) => resolve(next));
    },
    current: () => element,
    whenReady(): Promise<T> {
      if (element !== null) return Promise.resolve(element);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
