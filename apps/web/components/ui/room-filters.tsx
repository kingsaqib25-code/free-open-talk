'use client';

import { useState } from 'react';
import { cn } from '@/lib/design-system';
import { Tabs, TabsList, TabsTrigger } from './primitives';
import { SearchInput } from './input';
import { Button } from './button';
import { Filter, SortDesc } from './icons';

interface RoomFiltersProps {
    onSearch?: (query: string) => void;
    onFilterChange?: (filters: RoomFilterState) => void;
    /** Live room counts keyed by language name (plus 'All' for the total). */
    languageCounts?: Record<string, number>;
    className?: string;
}

export interface RoomFilterState {
    language: string | null;
    sortBy: 'popular' | 'recent' | 'participants';
    category: string | null;
}

const languages = [
    'All',
    'English',
    'Spanish',
    'French',
    'German',
    'Japanese',
    'Korean',
    'Chinese',
    'Portuguese',
    'Russian',
    'Italian',
    'Arabic',
    'Hindi',
    'Urdu',
    'Dutch',
    'Swedish',
    'Polish',
];

const categories = [
    { id: 'all', label: 'All' },
    { id: 'casual', label: 'Casual' },
    { id: 'learning', label: 'Learning' },
    { id: 'discussion', label: 'Discussion' },
    { id: 'gaming', label: 'Gaming' },
];

export function RoomFilters({ onSearch, onFilterChange, languageCounts, className }: RoomFiltersProps) {
    const [selectedLanguage, setSelectedLanguage] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');

    const handleLanguageChange = (lang: string) => {
        setSelectedLanguage(lang);
        onFilterChange?.({
            language: lang === 'All' ? null : lang,
            sortBy: 'popular',
            category: null,
        });
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
        onSearch?.(e.target.value);
    };

    return (
        <div className={cn('space-y-4', className)}>
            {/* Search - Mobile */}
            <div className="md:hidden">
                <SearchInput
                    value={searchQuery}
                    onChange={handleSearch}
                    placeholder="Search rooms..."
                />
            </div>

            {/* Language Filter Pills - Horizontal scroll on mobile */}
            <div className="relative">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
                    {languages.map((lang) => {
                        const count = languageCounts?.[lang];
                        return (
                            <button
                                key={lang}
                                onClick={() => handleLanguageChange(lang)}
                                className={cn(
                                    'flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                                    selectedLanguage === lang
                                        ? 'bg-primary-500 text-white'
                                        : 'bg-surface-default text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-surface-border'
                                )}
                            >
                                {lang}
                                {count !== undefined && (
                                    <span
                                        className={cn(
                                            'ml-1.5',
                                            selectedLanguage === lang
                                                ? 'text-white/80'
                                                : 'text-text-tertiary'
                                        )}
                                    >
                                        · {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                {/* Fade indicator for scroll */}
                <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-background-primary to-transparent pointer-events-none md:hidden" />
            </div>

            {/* Sort & More Filters - Desktop */}
            <div className="hidden md:flex items-center justify-between">
                <Tabs defaultValue="all" suppressHydrationWarning>
                    <TabsList>
                        {categories.map((cat) => (
                            <TabsTrigger key={cat.id} value={cat.id}>
                                {cat.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm">
                        <SortDesc className="h-4 w-4" />
                        Sort
                    </Button>
                    <Button variant="ghost" size="sm">
                        <Filter className="h-4 w-4" />
                        Filter
                    </Button>
                </div>
            </div>
        </div>
    );
}
