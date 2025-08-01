using namespace QPI;

struct QDRAW2
{
};

struct QDRAW : public ContractBase
{
public:
    uint64_t ticketCount;

    struct buyTicket_input
    {
    };

    struct buyTicket_output
    {
    };

    struct getInfo_input
    {
    };
    struct getInfo_output
    {
        uint64 someInteger;
    };

protected:

    PUBLIC_PROCEDURE(buyTicket)
    {
    }

    PUBLIC_FUNCTION(getInfo)
    {
        output.someInteger = 7; 
    }

    REGISTER_USER_FUNCTIONS_AND_PROCEDURES()
    {
        REGISTER_USER_PROCEDURE(buyTicket, 1);
        REGISTER_USER_FUNCTION(getInfo, 2);
    }

    INITIALIZE()
    {

    }
};
