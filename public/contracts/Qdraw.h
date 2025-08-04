using namespace QPI;

constexpr sint64 QDRAW_TICKET_PRICE = 1000000LL;
constexpr uint64 QDRAW_MAX_PARTICIPANTS = 1024;
// constexpr uint32 QDRAW_TICK_INTERVAL = 100;

struct QDRAW2
{
};

struct QDRAW : public ContractBase
{
public:
    struct buyTicket_input
    {
        uint64 ticketCount;
    };
    struct buyTicket_output
    {
    };

    struct getInfo_input
    {
    };
    struct getInfo_output
    {
        sint64 pot;
        uint64 participantCount;
        uint8 lastDrawHour;
        uint8 currentHour;
        uint8 nextDrawHour;
    };

    struct getParticipants_input
    {
    };
    struct getParticipants_output
    {
        uint64 participantCount;
        Array<id, QDRAW_MAX_PARTICIPANTS> participants;
    };

    struct getDigest_input
    {
    };
    struct getDigest_output
    {
        uint64 part0;
        uint64 part1;
        uint64 part2;
        uint64 part3;
        id k12;
    };

protected:
    Array<id, QDRAW_MAX_PARTICIPANTS> _participants;
    uint64 _participantCount;
    sint64 _pot;
    uint8 _lastDrawHour;

    PUBLIC_PROCEDURE(buyTicket)
    {
        uint64 available = QDRAW_MAX_PARTICIPANTS - state._participantCount;
        if (input.ticketCount == 0 || input.ticketCount > available)
        {
            if (qpi.invocationReward() > 0)
                qpi.transfer(qpi.invocator(), qpi.invocationReward());
            return;
        }

        sint64 totalCost = (sint64)input.ticketCount * QDRAW_TICKET_PRICE;
        if (qpi.invocationReward() < totalCost)
        {
            if (qpi.invocationReward() > 0)
                qpi.transfer(qpi.invocator(), qpi.invocationReward());
            return;
        }

        for (uint64 i = 0; i < input.ticketCount; ++i)
            state._participants.set(state._participantCount + i, qpi.invocator());

        state._participantCount += input.ticketCount;
        state._pot += totalCost;

        if (qpi.invocationReward() > totalCost)
            qpi.transfer(qpi.invocator(), qpi.invocationReward() - totalCost);
    }

    PUBLIC_FUNCTION(getInfo)
    {
        uint8 qpiHour = qpi.hour();
        output.pot = state._pot;
        output.participantCount = state._participantCount;
        output.lastDrawHour = state._lastDrawHour;
        output.currentHour = qpiHour;
        output.nextDrawHour = qpiHour+1;
    }

    PUBLIC_FUNCTION(getParticipants)
    {
        output.participantCount = state._participantCount;
        for (uint64 i = 0; i < QDRAW_MAX_PARTICIPANTS; ++i)
            output.participants.set(i, state._participants.get(i));
    }

    PUBLIC_FUNCTION(getDigest)
    {
        m256i spectrumDigest =  qpi.getPrevSpectrumDigest();
        output.part0 =  spectrumDigest.m256i_u64[0];
        output.part1 =  spectrumDigest.m256i_u64[1];
        output.part2 =  spectrumDigest.m256i_u64[2];
        output.part3 =  spectrumDigest.m256i_u64[3];
        output.k12 = qpi.K12(spectrumDigest);
    }

    REGISTER_USER_FUNCTIONS_AND_PROCEDURES()
    {
        REGISTER_USER_PROCEDURE(buyTicket, 1);
        REGISTER_USER_FUNCTION(getInfo, 2);
        REGISTER_USER_FUNCTION(getParticipants, 3);
        REGISTER_USER_FUNCTION(getDigest, 4);
    }

    INITIALIZE()
    {
        state._participantCount = 0;
        state._pot = 0;
        // state._nextDrawTick = qpi.tick() + QDRAW_TICK_INTERVAL;
        state._lastDrawHour = qpi.hour();
    }

    BEGIN_TICK()
    {
        uint8 currentHour = qpi.hour();
        if (currentHour != state._lastDrawHour && state._participantCount > 0 && state._pot > 0)
        {
            // uint64 idx = qpi.getPrevSpectrumDigest().m256i_u64[3] % state._participantCount; // using element [3] , because likely has biggest variance?
            // id winner = state._participants.get(idx);
            // // id rand = qpi.K12(qpi.tick() + state._pot);
            // // uint64 idx = rand.u64._0 % state._participantCount;
            // // id winner = state._participants.get(idx);

            m256i spectrumDigest = qpi.getPrevSpectrumDigest();
            id rand = qpi.K12(spectrumDigest);
            uint64 idx = rand.u64._0 % state._participantCount;
            id winner = state._participants.get(idx);

            qpi.transfer(winner, state._pot);
            state._participantCount = 0;
            state._pot = 0;
            state._lastDrawHour = currentHour; // to memorize last draw hour
            // state._nextDrawTick += QDRAW_TICK_INTERVAL;
        }
    }
};
