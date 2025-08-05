using namespace QPI;

// Fixed upper bound of pending deposits
constexpr uint32 MIXER_MAX_DEPOSITS = 1024;

// Minimum number of ticks to wait after the first deposit
constexpr uint32 MIXER_DELAY_TICKS = 10;

// Minimum number of deposits required before mixing
constexpr uint32 MIXER_MIN_DEPOSITS = 2;

// Single deposit record stored in contract state
struct MixerDeposit
{
    id depositor; // who made the deposit
    id outputId;  // destination address
    sint64 amount; // deposited amount
    uint32 tick;   // tick at which deposit occurred
};

struct QMIX2 {};

struct QMIX : public ContractBase
{
public:
    // Parameters for a deposit: the caller sends QUs via invocation reward
    struct deposit_input
    {
        id outputId; // address that will receive the payout
    };
    struct deposit_output
    {
    };

    // Debug function returning pool statistics
    struct getPoolInfo_input
    {
    };
    struct getPoolInfo_output
    {
        uint32 depositCount; // number of pending deposits
        sint64 totalAmount;  // total amount locked in the pool
    };

protected:
    // Pool of pending deposits
    Array<MixerDeposit, MIXER_MAX_DEPOSITS> _deposits;
    uint32 _depositCount;
    uint32 _firstDepositTick;

    // Store a new deposit and its intended destination
    PUBLIC_PROCEDURE(deposit)
    {
        sint64 amount = qpi.invocationReward();
        id caller = qpi.invocator();

        if (amount <= 0 || state._depositCount >= MIXER_MAX_DEPOSITS)
        {
            // return funds if pool full or nothing sent
            if (amount > 0)
                qpi.transfer(caller, amount);
            return;
        }

        // reject if caller already has a pending deposit
        for (uint32 i = 0; i < state._depositCount; ++i)
            if (state._deposits.get(i).depositor == caller)
            {
                qpi.transfer(caller, amount);
                return;
            }

        MixerDeposit d;
        d.depositor = caller;
        d.outputId = input.outputId;
        d.amount = amount;
        d.tick = qpi.tick();
        state._deposits.set(state._depositCount, d);
        state._depositCount++;
        if (state._depositCount == 1)
            state._firstDepositTick = d.tick;
    }

    // Return number of pending deposits and the total amount stored
    PUBLIC_FUNCTION(getPoolInfo)
    {
        output.depositCount = state._depositCount;
        sint64 total = 0;
        for (uint32 i = 0; i < state._depositCount; ++i)
            total += state._deposits.get(i).amount;
        output.totalAmount = total;
    }

    REGISTER_USER_FUNCTIONS_AND_PROCEDURES()
    {
        REGISTER_USER_PROCEDURE(deposit, 1);
        REGISTER_USER_FUNCTION(getPoolInfo, 2);
    }

    INITIALIZE()
    {
        state._depositCount = 0;
        state._firstDepositTick = 0;
    }

    BEGIN_TICK()
    {
        if (state._depositCount >= MIXER_MIN_DEPOSITS &&
            qpi.tick() - state._firstDepositTick >= MIXER_DELAY_TICKS)
             
        {
            // _mixAndDistribute function
            // derive initial seed from previous spectrum digest
            m256i digest = qpi.getPrevSpectrumDigest();
            id seed = qpi.K12(digest);

            // Fisher-Yates shuffle using successive K12(seed)
            for (uint32 i = state._depositCount - 1; i > 0; --i)
            {
                seed = qpi.K12(seed);
                uint64 j = seed.u64._0 % (i + 1);
                MixerDeposit di = state._deposits.get(i);
                MixerDeposit dj = state._deposits.get(j);
                state._deposits.set(i, dj);
                state._deposits.set(j, di);
            }

            // pay out shuffled deposits
            for (uint32 i = 0; i < state._depositCount; ++i)
            {
                MixerDeposit d = state._deposits.get(i);
                qpi.transfer(d.outputId, d.amount);
            }

            state._depositCount = 0;
            state._firstDepositTick = 0;
            // _mixAndDistribute
        }

            
    }
};
