
public abstract class User
{
  public abstract string Name { get; set; }
  public abstract string Email { get; set; }
  public abstract DateTime Birthday { get; set; }

  public static User New()
  {
    return new User_O();
  }
}
