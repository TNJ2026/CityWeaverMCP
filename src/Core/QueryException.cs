using System;

namespace CityWeaver
{
    public sealed class QueryException : Exception
    {
        public string Code { get; }
        public QueryException(string code,string message):base(message){Code=code;}
    }
}
