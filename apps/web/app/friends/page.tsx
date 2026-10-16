import { MainLayout, PageContainer } from '@/components/ui';
import { FriendsList } from '@/components/friends/friends-list';

export default function FriendsPage() {
    return (
        <MainLayout headerTitle="Friends" showFAB={false}>
            <PageContainer maxWidth="lg">
                <div className="py-6">
                    <h1 className="mb-1 text-2xl font-bold text-text-primary">
                        Friends 🧡
                    </h1>
                    <p className="mb-5 text-sm text-text-secondary">
                        People you follow — tap to jump into their room when
                        they&apos;re online.
                    </p>
                    <FriendsList />
                </div>
            </PageContainer>
        </MainLayout>
    );
}
