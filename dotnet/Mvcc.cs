
internal class Mvcc<T>
{
  // Listening, history, etc.

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
