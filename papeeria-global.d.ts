interface MutableMap<T> {
  [key: string]: T;
}

type Map<T> = Readonly<MutableMap<T>>;

type List<T> = ReadonlyArray<T>;

type MutableList<T> = Array<T>;

type Consumer<T> = (arg: T) => void;

type Callable = () => void;

