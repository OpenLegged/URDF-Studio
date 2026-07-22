import { createElement, type ComponentType } from 'react';

export interface PreloadableComponentResource<Props extends object> {
  readonly Component: ComponentType<Props>;
  readonly preload: () => Promise<void>;
}

/**
 * Creates a Suspense-compatible component whose loader can be started before
 * render. A successful load is retained for the application lifetime, while a
 * failed load is cleared so a later user interaction can retry it.
 */
export function createPreloadableComponent<Module, Props extends object>(
  loader: () => Promise<Module>,
  select: (module: Module) => ComponentType<Props>,
): PreloadableComponentResource<Props> {
  let loadedComponent: ComponentType<Props> | null = null;
  let loadPromise: Promise<void> | null = null;

  const preload = (): Promise<void> => {
    if (loadPromise) {
      return loadPromise;
    }

    let modulePromise: Promise<Module>;
    try {
      modulePromise = loader();
    } catch (error) {
      modulePromise = Promise.reject(error);
    }

    loadPromise = modulePromise.then(select).then(
      (component) => {
        loadedComponent = component;
      },
      (error: unknown) => {
        loadPromise = null;
        throw error;
      },
    );

    return loadPromise;
  };

  function Component(props: Props) {
    if (!loadedComponent) {
      throw preload();
    }

    return createElement(loadedComponent, props);
  }

  Component.displayName = 'PreloadableComponent';

  return { Component, preload };
}
