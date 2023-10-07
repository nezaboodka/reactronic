
internal class Mvcc<T>
{
  // Subscriptions, history, etc.

  public Mvcc(T value)
  {
    Value = value;
  }

  public T Value
  {
    get; // TBD
    set; // TBD
  }
}
