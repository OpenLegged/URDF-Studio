import { ForwardRefExoticComponent, PropsWithoutRef, RefAttributes } from 'react';
export type NamedArrayTuple<T extends (...args: any) => any> = Parameters<T>;
export type ForwardRefComponent<P, T> = ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>;
export type NonFunctionKeys<T> = {
    [K in keyof T]-?: T[K] extends Function ? never : K;
}[keyof T];
export type Overwrite<T, O> = Omit<T, NonFunctionKeys<O>> & O;
